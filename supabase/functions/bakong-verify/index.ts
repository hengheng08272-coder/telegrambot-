import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// =====================================================================
// Ask Bakong whether this ticket's QR has been paid, and grant VIP if so.
//
// This is the only auto-confirm path in the project that asks the BANK a
// question instead of reading a notification about one. The app generates
// its own KHQR per ticket (src/lib/bakong.ts), every payload has an md5,
// and Bakong's Open API answers exactly one question about that md5:
// "has this been paid?". Per-ticket, so there is nothing to match.
//
// Required secret:
//   BAKONG_API_TOKEN   -- developer token from api-bakong.nbc.gov.kh
// Optional:
//   BAKONG_API_BASE    -- defaults to https://api-bakong.nbc.gov.kh
//   TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID  -- to ping the admin
//
// ---------------------------------------------------------------------
// WHY THIS IS SAFE TO CALL WITHOUT AUTH
//
// The caller hands over a submission id and the md5 of the QR that was
// drawn for it. That is not a claim this function trusts — it is only the
// question it goes and asks the bank. Approval requires ALL of:
//
//   1. Bakong reports the payload as paid;
//   2. the amount paid equals the ticket's amount;
//   3. the money went to the account configured in the admin panel;
//   4. the bank's transaction hash has never been used before
//      (unique index -- see database/bakong-md5-addition.sql);
//   5. the ticket is still pending.
//
// So the worst a stranger can do by guessing ids is cause this function
// to ask the bank about a payment that either does not exist, or is one
// they genuinely made to the owner for the right amount. Contrast with
// auto-approve-payment, which grants on the caller's say-so alone.
//
// Check 3 is what stops the real attack: replaying the md5 of a QR paid
// to somebody else. It is skipped only when the owner's configured
// account id is a bank-level id (ABA issues the same `abaakhppxxx@abaa`
// to every customer, with the account number carried separately), in
// which case checks 1, 2, 4 and 5 still hold -- see ACCOUNT_CHECK below.
// =====================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Fallback only -- live source of truth is pricing_tiers.months.
const TIER_MONTHS_FALLBACK: Record<string, number> = { "1m": 1, "2m": 2, "3m": 3, "6m": 6, "12m": 12 };

/** How long after a ticket opens a matching payment is still accepted. */
const PAYMENT_GRACE_MS = 30 * 60 * 1000;

interface BakongEnvelope {
  responseCode?: number;
  responseMessage?: string;
  errorCode?: number | null;
  data?: {
    hash?: string;
    fromAccountId?: string;
    toAccountId?: string;
    currency?: string;
    amount?: number;
    description?: string;
    createdDateMs?: number;
    acknowledgedDateMs?: number;
  } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const { submission_id, md5, dry_run } = await req.json();
    if (!submission_id || typeof md5 !== "string" || !/^[0-9a-f]{32}$/i.test(md5)) {
      return json({ error: "submission_id and a 32-char md5 are required" }, 400);
    }

    const token = Deno.env.get("BAKONG_API_TOKEN");
    if (!token) return json({ error: "BAKONG_API_TOKEN is not set", configured: false }, 503);

    const base = (Deno.env.get("BAKONG_API_BASE") ?? "https://api-bakong.nbc.gov.kh").replace(/\/+$/, "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: sub } = await admin
      .from("payment_submissions")
      .select("*")
      .eq("id", submission_id)
      .maybeSingle();
    if (!sub) return json({ error: "not found" }, 404);
    if (sub.status !== "pending") return json({ ok: true, alreadyHandled: true, status: sub.status });

    // Remember the md5 the first time we see it, so the admin panel and
    // any later reconciliation can look up the same question. Written
    // here rather than by the client because RLS (correctly) does not let
    // a viewer update this table at all.
    if (!sub.khqr_md5) {
      await admin.from("payment_submissions").update({ khqr_md5: md5 }).eq("id", submission_id);
    }

    // ---- ask the bank -------------------------------------------------
    let envelope: BakongEnvelope;
    let httpStatus: number;
    try {
      const resp = await fetch(`${base}/v1/check_transaction_by_md5`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ md5 }),
        signal: AbortSignal.timeout(20_000),
      });
      httpStatus = resp.status;
      envelope = await resp.json().catch(() => ({}));
    } catch (err) {
      // A network blip must read as "not yet", never as a decision. The
      // viewer's app simply polls again.
      return json({ ok: true, paid: false, pending: true, reason: "bakong-unreachable", detail: String(err) });
    }

    // An expired or rejected token is the owner's problem to fix, and it
    // is invisible unless it is said out loud -- otherwise auto-confirm
    // just silently never fires. Tokens from the NBC are time-limited and
    // have to be renewed; see BAKONG_AUTO_CONFIRM_SETUP.md.
    if (httpStatus === 401 || httpStatus === 403) {
      return json({ ok: false, paid: false, reason: "token-rejected", httpStatus, envelope }, 200);
    }

    // dry_run exists because the exact field names of this response can
    // only be confirmed against the live API. Call it once with a real
    // md5 to see precisely what Bakong returns, without anything being
    // granted on the strength of a guess.
    if (dry_run) return json({ ok: true, dryRun: true, httpStatus, envelope });

    const paid = envelope.responseCode === 0 && !!envelope.data;
    if (!paid) {
      return json({ ok: true, paid: false, pending: true, reason: envelope.responseMessage ?? "not-paid" });
    }

    const tx = envelope.data!;

    // ---- checks 2, 3 and the freshness check --------------------------
    const expected = Number(sub.amount);
    const actual = Number(tx.amount);
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.009) {
      return json({ ok: false, paid: true, granted: false, reason: "amount-mismatch", expected, actual });
    }
    if (tx.currency && String(tx.currency).toUpperCase() !== "USD") {
      return json({ ok: false, paid: true, granted: false, reason: "currency-mismatch", currency: tx.currency });
    }

    const { data: settings } = await admin
      .from("app_settings")
      .select("key, value")
      .in("key", ["bakong_account_id", "bakong_account_information"]);
    const settingMap = new Map((settings ?? []).map((r) => [r.key as string, String(r.value ?? "").trim()]));
    const configuredAccount = settingMap.get("bakong_account_id") ?? "";

    // ACCOUNT_CHECK: an ABA-style id names the bank, not one account
    // inside it, so comparing it to the destination of a real payment
    // proves nothing. Only compare when the configured id identifies an
    // actual account.
    const isBankLevelId = /^abaakhpp/i.test(configuredAccount);
    if (configuredAccount && !isBankLevelId && tx.toAccountId) {
      if (String(tx.toAccountId).toLowerCase() !== configuredAccount.toLowerCase()) {
        return json({
          ok: false, paid: true, granted: false,
          reason: "wrong-destination", expected: configuredAccount, actual: tx.toAccountId,
        });
      }
    }

    const paidAt = Number(tx.acknowledgedDateMs ?? tx.createdDateMs ?? 0);
    const openedAt = new Date(sub.submitted_at ?? Date.now()).getTime();
    if (paidAt && paidAt < openedAt - PAYMENT_GRACE_MS) {
      // A payment older than the ticket cannot be for this ticket.
      return json({ ok: false, paid: true, granted: false, reason: "payment-predates-ticket" });
    }

    // ---- grant --------------------------------------------------------
    const { data: tierRow } = await admin
      .from("pricing_tiers").select("months").eq("key", sub.tier).maybeSingle();
    const months = tierRow?.months ?? TIER_MONTHS_FALLBACK[sub.tier] ?? 1;

    const { data: existing } = await admin
      .from("subscriptions").select("expires_at").eq("telegram_user_id", sub.telegram_user_id).maybeSingle();
    const base_ = existing?.expires_at && new Date(existing.expires_at) > new Date()
      ? new Date(existing.expires_at) : new Date();
    base_.setMonth(base_.getMonth() + months);

    // Claim the bank's transaction id FIRST. The unique index turns this
    // into the replay guard: whichever poll gets here first wins, and a
    // second attempt to spend the same payment is refused by Postgres
    // rather than granting a second month.
    const { error: claimErr } = await admin
      .from("payment_submissions")
      .update({
        bakong_hash: tx.hash ?? `${md5}:${paidAt}`,
        status: "approved",
        // Not an optimistic grant (auto_approved) and not something a
        // human needs to look at (the bank already confirmed it), so it
        // stays out of Admin -> Payments -> Waitlist by design.
        auto_approved: false,
        admin_confirmed: true,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", submission_id)
      .eq("status", "pending");

    if (claimErr) {
      return json({ ok: false, paid: true, granted: false, reason: "already-claimed", detail: claimErr.message });
    }

    await admin.from("subscriptions").upsert({
      telegram_user_id: sub.telegram_user_id,
      telegram_username: sub.telegram_username,
      tier: sub.tier,
      expires_at: base_.toISOString(),
      updated_at: new Date().toISOString(),
    });

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
    if (botToken && adminChatId) {
      const text =
        "🏦 ការទូទាត់បានផ្ទៀងផ្ទាត់ដោយធនាគារ (Bakong)\n\n" +
        `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
        `📦 ${sub.tier} — $${sub.amount}\n` +
        `🔖 ${tx.hash ?? "-"}\n\n` +
        "មិនចាំបាច់ពិនិត្យទេ — ធនាគារបានបញ្ជាក់រួចហើយ។";
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: adminChatId, text }),
      }).catch(() => {});
    }

    return json({ ok: true, paid: true, granted: true, hash: tx.hash ?? null });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
