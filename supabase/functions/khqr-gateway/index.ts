import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// =====================================================================
// KHQR through a payment gateway: issue the QR, then ask whether it was
// paid, and grant VIP the moment it was.
//
// WHY THIS EXISTS ALONGSIDE bakong-verify
//   bakong-verify asks the NBC directly about a QR this app built
//   itself, which needs `bakong_account_id` configured in the admin
//   panel and an NBC developer token. Neither is set (the account id is
//   an empty string in app_settings), so nothing was auto-confirming and
//   every payment waited on a screenshot and a human.
//
//   This gateway does both halves instead: it mints the QR *and* answers
//   "has bill X been paid?". Because the bill is minted per ticket, the
//   question is already scoped to one payment attempt -- there is
//   nothing to match by amount or timing, which is what made the ABA
//   notification path fragile.
//
// ACTIONS
//   { action: "generate", submission_id }  -> mints a QR for the ticket
//   { action: "check",    submission_id }  -> polls, grants when paid
//
// Required secret:
//   KHQR_GATEWAY_TOKEN   -- the api_token issued by the gateway
// Optional:
//   KHQR_GATEWAY_BASE    -- defaults to https://mengsmm.store
//   KHQR_GATEWAY_ACCOUNT, KHQR_GATEWAY_MERCHANT_NAME,
//   KHQR_GATEWAY_MERCHANT_CITY, KHQR_GATEWAY_STORE_LABEL,
//   KHQR_GATEWAY_TERMINAL_LABEL  -- passed through to the gateway
//   TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID   -- to notify the admin
//
// ---------------------------------------------------------------------
// WHY THIS IS SAFE TO CALL WITHOUT AUTH
//
// A caller supplies only a ticket id. Nothing it says is believed: the
// amount comes from the ticket row, the bill number comes from the
// gateway, and a grant requires ALL of
//
//   1. the gateway reports that bill as SUCCESS/PAID;
//   2. the amount it reports matches the ticket's amount;
//   3. the bill number has never been granted before (unique index);
//   4. the ticket is still pending.
//
// So guessing ids gets a stranger nothing except an answer about a
// payment they would have had to make themselves, for the right amount,
// against a bill this server minted.
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

// Both spellings mean the money arrived.
const PAID_WORDS = new Set(["SUCCESS", "PAID", "COMPLETED"]);
const EXPIRED_WORDS = new Set(["EXPIRED", "TIMEOUT", "CANCELLED", "CANCELED"]);

// TELEGRAM_ADMIN_CHAT_ID may hold more than one id, separated by commas or
// spaces ("111111,7777639689") — every id listed gets the same admin
// notifications, and a single id keeps behaving exactly as before.
function adminChatIds(): string[] {
  return (Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

interface GatewayReply {
  status?: string;
  success?: boolean;
  message?: string;
  error?: string;
  amount?: number | string;
  currency?: string;
  bill_number?: string;
  time_remaining_seconds?: number | string;
  data?: {
    qr?: string;
    qr_string?: string;
    md5?: string;
    bill_number?: string;
    status?: string;
    qr_image_url?: string;
    amount?: number | string;
    currency?: string;
    expires_at?: string;
  } | null;
}

/** One GET against the gateway. Authentication is `api_token` in the query, not a header. */
async function callGateway(params: Record<string, string>): Promise<{ ok: boolean; status: number; body: GatewayReply }> {
  const base = (Deno.env.get("KHQR_GATEWAY_BASE") ?? "https://mengsmm.store").replace(/\/+$/, "");
  const query = new URLSearchParams({ ...params, api_token: Deno.env.get("KHQR_GATEWAY_TOKEN")! });
  const url = `${base}/api/v1/?${query.toString()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: GatewayReply;
  try {
    body = JSON.parse(text);
  } catch {
    // Logged with the type only: the full URL carries the token.
    console.error(`[GATEWAY] ${params.type} returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
    return { ok: false, status: res.status, body: {} };
  }
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const { submission_id, action } = await req.json().catch(() => ({}));
    if (!submission_id) return json({ error: "submission_id is required" }, 400);

    if (!Deno.env.get("KHQR_GATEWAY_TOKEN")) {
      // Said out loud rather than silently doing nothing: an unset token
      // means auto-confirm never fires, and that is invisible otherwise.
      return json({ error: "KHQR_GATEWAY_TOKEN is not set", configured: false }, 503);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: sub } = await admin
      .from("payment_submissions")
      .select("*")
      .eq("id", submission_id)
      .maybeSingle();
    if (!sub) return json({ error: "not found" }, 404);

    if (action === "generate") return await generate(admin, sub);
    return await check(admin, sub);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------

async function generate(admin: ReturnType<typeof createClient>, sub: Record<string, unknown>) {
  if (sub.status !== "pending") {
    return json({ error: "this ticket is no longer open", status: sub.status }, 409);
  }

  const amount = Number(sub.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ error: "this ticket has no usable amount" }, 400);
  }

  const { ok, status, body } = await callGateway({
    type: "generate_qr",
    // The ticket's own price, never a figure the caller supplied.
    amount: amount.toFixed(2),
    currency: "USD",
    account_id: Deno.env.get("KHQR_GATEWAY_ACCOUNT") ?? "",
    merchant_name: Deno.env.get("KHQR_GATEWAY_MERCHANT_NAME") ?? "",
    merchant_city: Deno.env.get("KHQR_GATEWAY_MERCHANT_CITY") ?? "",
    store_label: Deno.env.get("KHQR_GATEWAY_STORE_LABEL") ?? "",
    terminal_label: Deno.env.get("KHQR_GATEWAY_TERMINAL_LABEL") ?? "",
  });

  const data = body.data;
  if (!ok || body.success === false || !data) {
    const reason = body.message ?? body.error ?? `gateway HTTP ${status}`;
    console.error(`[GATEWAY] generate failed: ${reason}`);
    return json({ ok: false, error: "the payment gateway did not return a QR", reason }, 502);
  }

  const qrString = String(data.qr_string ?? data.qr ?? "").trim();
  const md5 = String(data.md5 ?? "").trim();
  const billNumber = String(data.bill_number ?? "").trim();
  const expiresAt = String(data.expires_at ?? "");

  if (!qrString && !data.qr_image_url) {
    return json({ ok: false, error: "the payment gateway returned a QR with no code in it" }, 502);
  }
  if (!md5 && !billNumber) {
    return json({ ok: false, error: "the payment gateway returned a QR that cannot be checked later" }, 502);
  }

  // The gateway is not assumed to mint a fresh bill. If it hands back the
  // one already stored against a DIFFERENT ticket, that bill's payment
  // would confirm the wrong ticket, so it is refused rather than shown.
  if (billNumber) {
    const { data: clash } = await admin
      .from("payment_submissions")
      .select("id")
      .eq("khqr_bill_number", billNumber)
      .neq("id", sub.id as string)
      .maybeSingle();
    if (clash) {
      console.error(`[GATEWAY] reused bill ${billNumber} (already on ticket ${clash.id})`);
      return json({
        ok: false,
        stale: true,
        error:
          "The payment server returned the same expired QR again. A fresh QR was not created.",
      }, 502);
    }
  }

  await admin
    .from("payment_submissions")
    .update({ khqr_md5: md5 || null, khqr_bill_number: billNumber || null })
    .eq("id", sub.id as string);

  return json({
    ok: true,
    qr_string: qrString,
    qr_image_url: data.qr_image_url ?? null,
    md5,
    bill_number: billNumber,
    expires_at: expiresAt,
    amount: Number(data.amount ?? amount),
    currency: String(data.currency ?? "USD"),
  });
}

// ---------------------------------------------------------------------
// check
// ---------------------------------------------------------------------

async function check(admin: ReturnType<typeof createClient>, sub: Record<string, unknown>) {
  if (sub.status !== "pending") {
    return json({ ok: true, alreadyHandled: true, granted: sub.status === "approved", status: sub.status });
  }

  const billNumber = String(sub.khqr_bill_number ?? "");
  const md5 = String(sub.khqr_md5 ?? "");
  if (!billNumber && !md5) {
    return json({ ok: true, paid: false, pending: true, reason: "no-qr-issued-yet" });
  }

  let reply: Awaited<ReturnType<typeof callGateway>>;
  try {
    reply = await callGateway(
      billNumber ? { type: "check_md5", bill_number: billNumber } : { type: "check_md5", md5 },
    );
  } catch (err) {
    // A network blip reads as "not yet", never as a decision: the app
    // simply asks again three seconds later.
    return json({ ok: true, paid: false, pending: true, reason: "gateway-unreachable", detail: String(err) });
  }

  const { status: httpStatus, body } = reply;
  if (httpStatus === 401 || httpStatus === 403) {
    // The owner's token has expired or been rejected. Loud, because
    // otherwise auto-confirm just quietly never fires again.
    console.error("[GATEWAY] token rejected — auto-confirm is off until it is renewed");
    return json({ ok: false, paid: false, reason: "token-rejected", httpStatus });
  }

  const word = String(body.status ?? "").trim().toUpperCase();

  if (EXPIRED_WORDS.has(word)) {
    return json({ ok: true, paid: false, expired: true, reason: "qr-expired" });
  }
  if (!PAID_WORDS.has(word)) {
    const seconds = Number(body.time_remaining_seconds);
    return json({
      ok: true,
      paid: false,
      pending: true,
      status: word || "PENDING",
      seconds_remaining: Number.isFinite(seconds) ? seconds : null,
    });
  }

  // ---- paid: verify the figure before believing it -------------------
  const expected = Number(sub.amount);
  const actual = Number(body.amount);
  if (Number.isFinite(actual) && Math.abs(actual - expected) > 0.009) {
    console.error(`[GATEWAY] amount mismatch on ${billNumber}: expected ${expected}, got ${actual}`);
    return json({ ok: false, paid: true, granted: false, reason: "amount-mismatch", expected, actual });
  }
  if (body.currency && String(body.currency).toUpperCase() !== "USD") {
    return json({ ok: false, paid: true, granted: false, reason: "currency-mismatch", currency: body.currency });
  }

  // ---- claim, then grant ---------------------------------------------
  // The claim comes FIRST. Two polls can land in the same second (the
  // app's own loop and a retry), and granting before claiming is exactly
  // how one payment used to buy two months.
  const { data: claimed } = await admin
    .from("payment_submissions")
    .update({
      status: "approved",
      // The gateway confirmed the money, so this is not an optimistic
      // grant and there is nothing for a human to review: it stays out
      // of Admin -> Payments -> "needs confirmation" by design.
      auto_approved: false,
      admin_confirmed: true,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", sub.id as string)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return json({ ok: true, paid: true, granted: false, reason: "already-approved" });
  }

  const { data: tierRow } = await admin
    .from("pricing_tiers").select("months").eq("key", sub.tier as string).maybeSingle();
  const months = (tierRow?.months as number | undefined) ?? TIER_MONTHS_FALLBACK[String(sub.tier)] ?? 1;

  const { data: existing } = await admin
    .from("subscriptions").select("expires_at")
    .eq("telegram_user_id", sub.telegram_user_id as string).maybeSingle();
  const expiry = existing?.expires_at && new Date(existing.expires_at as string) > new Date()
    ? new Date(existing.expires_at as string)
    : new Date();
  expiry.setMonth(expiry.getMonth() + months);

  await admin.from("subscriptions").upsert({
    telegram_user_id: sub.telegram_user_id,
    telegram_username: sub.telegram_username,
    tier: sub.tier,
    expires_at: expiry.toISOString(),
    updated_at: new Date().toISOString(),
  });

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatIds = adminChatIds();
  if (botToken && chatIds.length > 0) {
    const text =
      "🏦 ការទូទាត់បានផ្ទៀងផ្ទាត់ដោយ KHQR gateway\n\n" +
      `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
      `📦 ${sub.tier} — $${sub.amount}\n` +
      `🔖 ${billNumber || md5}\n\n` +
      "មិនចាំបាច់ពិនិត្យទេ — ប្រព័ន្ធបានបញ្ជាក់រួចហើយ។";
    for (const chatId of chatIds) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).catch(() => {});
    }
  }

  return json({ ok: true, paid: true, granted: true, bill_number: billNumber || null });
}
