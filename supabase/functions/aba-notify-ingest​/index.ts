import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// =====================================================================
// PLAIN HTTPS ingest for ABA payment notifications — no Telegram at all.
//
// WHY THIS EXISTS
//   Telegram bots can never read messages written by another bot (it is
//   a hard platform rule, not a setting: core.telegram.org/bots/faq).
//   So the moment ABA's alerts are relayed into a group *by a bot*, the
//   `aba-payment-webhook` listener goes permanently deaf. This function
//   removes Telegram from the path completely: the notification-
//   forwarder app on the phone that holds the ABA account POSTs the
//   alert text straight here over HTTPS.
//
//   Matching logic is deliberately IDENTICAL to aba-payment-webhook
//   (merchant name must appear -> amount -> unique pending row of that
//   tier inside the match window -> grant). Both can run at the same
//   time; whichever sees the payment first wins, and the status guard on
//   the UPDATE makes a double-grant impossible.
//
// SETUP
//   1. Deploy this function.
//   2. Set one Supabase secret:
//        ABA_INGEST_SECRET = a long random string you invent
//   3. On the phone with the ABA app, install any notification-listener
//      app that can fire a custom HTTP request (Tasker, MacroDroid,
//      "Notification Forwarder", AutoNotification, etc.) and point it at:
//
//        POST https://<PROJECT-REF>.supabase.co/functions/v1/aba-notify-ingest
//        Header: x-aba-ingest-secret: <ABA_INGEST_SECRET>
//        Body (JSON): {"text": "<the full notification text>"}
//
//      If the app cannot set custom headers, it may instead append the
//      secret to the URL: ...?secret=<ABA_INGEST_SECRET>
//      If the app cannot send JSON, it may POST the raw notification
//      text as the body with any content-type — that is handled too.
//   4. Set the ABA account holder name in Admin Panel -> Subscriptions
//      -> "ABA Auto-confirm" (app_settings key `aba_merchant_name`),
//      exactly as it is printed in the real notification.
//   5. Send yourself $0.01 (or make a real test purchase) and read this
//      function's logs — every request logs the text it received and
//      exactly why it did or did not match.
//
// SECURITY
//   The secret is the only thing standing between this URL and a
//   stranger granting themselves VIP by POSTing fake text, so treat it
//   like a password: long, random, never committed to the repo, rotate
//   it if a phone is lost. Requests without it are rejected outright.
// =====================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-aba-ingest-secret",
};

// A pending request is only eligible while it is this fresh, so an old
// abandoned 'pending' row cannot grab a much later unrelated payment of
// the same amount. Mirrors aba-payment-webhook.
const MATCH_WINDOW_MIN = 15;

const AMOUNT_PATTERN =
  /(?:\$|USD)\s*([0-9]+(?:\.[0-9]{1,2})?)|([0-9]+(?:\.[0-9]{1,2})?)\s*(?:\$|USD)/i;

function extractAmount(text: string): number | null {
  const m = AMOUNT_PATTERN.exec(text);
  if (!m) return null;
  const raw = m[1] ?? m[2];
  const value = Math.round(parseFloat(raw) * 100) / 100;
  return Number.isFinite(value) ? value : null;
}

// ABA prints its own reference in every alert:
//   "$2.00 paid by ROM SARY (*297) on Aug 14, 04:54 PM via ABA PAY at
//    PANG SOK HENG S2_Nint.Ani. Trx. ID: 178670124828004, APV: 993238."
// That Trx. ID is unique per real payment, which makes it the only
// reliable replay guard available on this path — without it, a forwarder
// that retries (or the Telegram webhook and the HTTPS ingest both seeing
// the same alert) would grant a second month of VIP for one payment.
const TRX_ID_PATTERN = /Trx\.?\s*ID\s*[:#]?\s*([0-9]{6,})/i;
// Who paid, as printed. Display only — it changes every payment and has
// no link to a Telegram account, so it is never matched on.
const PAYER_PATTERN = /paid\s+by\s+(.+?)\s+on\s+/i;

function extractTrxId(text: string): string | null {
  const m = TRX_ID_PATTERN.exec(text);
  return m ? m[1] : null;
}

function extractPayer(text: string): string | null {
  const m = PAYER_PATTERN.exec(text);
  return m ? m[1].trim().slice(0, 120) : null;
}

// Fallback only — live source of truth is pricing_tiers.months.
const TIER_MONTHS_FALLBACK: Record<string, number> = {
  "1m": 1,
  "2m": 2,
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

async function tg(token: string, method: string, body: Record<string, unknown>) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Best-effort only — a notify failure must never affect confirmation.
  }
}

// Pull the notification text out of whatever shape the forwarder app
// sends. Different apps use different field names and some cannot send
// JSON at all, so accept them all rather than forcing one format.
function extractText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    const candidates = [
      parsed.text,
      parsed.message,
      parsed.body,
      parsed.content,
      parsed.notification,
      parsed.title && parsed.body ? `${parsed.title} ${parsed.body}` : undefined,
    ];
    const found = candidates.find((v) => typeof v === "string" && v.trim());
    if (found) return String(found);
    // Unknown JSON shape — flatten every string value so the merchant
    // name and amount can still be found somewhere inside it.
    return Object.values(parsed)
      .filter((v) => typeof v === "string")
      .join(" ");
  } catch {
    // Not JSON — the raw body IS the notification text.
    return raw;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: true, hint: "POST the notification text here" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const json = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const ingestSecret = Deno.env.get("ABA_INGEST_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Fail CLOSED when the secret is unset — an open endpoint here would
  // let anyone who guesses the URL mint themselves a VIP subscription.
  if (!ingestSecret) {
    console.error("[CONFIG] ABA_INGEST_SECRET is not set — refusing every request.");
    return json(503, { ok: false, error: "not_configured" });
  }

  const url = new URL(req.url);
  const provided =
    req.headers.get("x-aba-ingest-secret") ??
    url.searchParams.get("secret") ??
    "";
  if (provided !== ingestSecret) {
    console.log("[AUTH] Rejected a request with a missing/wrong secret.");
    return json(403, { ok: false, error: "forbidden" });
  }

  const rawBody = await req.text();
  const text = extractText(rawBody).trim();
  console.log(`[INGEST] text="${text.slice(0, 200)}"`);
  if (!text) return json(200, { ok: true, matched: false, reason: "empty_text" });

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: nameRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "aba_merchant_name")
      .maybeSingle();
    const merchantName = (nameRow?.value ?? "").trim().toUpperCase();

    if (!merchantName) {
      console.log("[NO_MATCH] aba_merchant_name is not set in Admin Panel -> Subscriptions.");
      return json(200, { ok: true, matched: false, reason: "merchant_name_unset" });
    }
    if (!text.toUpperCase().includes(merchantName)) {
      console.log(`[NO_MATCH] Merchant name "${merchantName}" not present in this text.`);
      return json(200, { ok: true, matched: false, reason: "merchant_name_absent" });
    }

    const amount = extractAmount(text);
    if (amount === null) {
      console.log(`[NO_MATCH] No usable amount in: "${text}"`);
      return json(200, { ok: true, matched: false, reason: "no_amount" });
    }

    const { data: tiers, error: tiersErr } = await admin
      .from("pricing_tiers")
      .select("key, price, months");
    if (tiersErr) {
      console.error("pricing_tiers lookup error:", tiersErr);
      return json(200, { ok: false, error: "tiers_lookup_failed" });
    }
    const tierForAmount = (tiers ?? []).find((t) => Number(t.price) === amount);
    if (!tierForAmount) {
      console.log(`[NO_MATCH] $${amount} doesn't match any current plan price.`);
      return json(200, { ok: true, matched: false, reason: "no_tier_for_amount", amount });
    }

    const trxId = extractTrxId(text);
    const payer = extractPayer(text);
    console.log(`[PARSED] amount=${amount} trx=${trxId ?? "-"} payer=${payer ?? "-"}`);

    // Replay guard — see TRX_ID_PATTERN above. A missing column here just
    // means database/aba-trx-id-addition.sql has not been run yet; the
    // flow still works, it simply loses the duplicate protection, so warn
    // loudly rather than failing the payment.
    if (trxId) {
      const { data: seen, error: seenErr } = await admin
        .from("payment_submissions")
        .select("id")
        .eq("aba_trx_id", trxId)
        .maybeSingle();
      if (seenErr) {
        console.warn(
          `[MIGRATION] Could not check aba_trx_id (${seenErr.message}). Run database/aba-trx-id-addition.sql to enable duplicate protection.`,
        );
      } else if (seen) {
        console.log(`[DUPLICATE] Trx ${trxId} was already applied to ${seen.id}; ignoring.`);
        return json(200, { ok: true, matched: false, reason: "duplicate_trx", trx_id: trxId });
      }
    }

    const sinceIso = new Date(Date.now() - MATCH_WINDOW_MIN * 60_000).toISOString();
    const { data: pendingRows, error: lookupError } = await admin
      .from("payment_submissions")
      .select("id, telegram_user_id, telegram_username, tier, amount")
      .eq("status", "pending")
      .eq("tier", tierForAmount.key)
      .gte("submitted_at", sinceIso);

    if (lookupError) {
      console.error("payment_submissions lookup error:", lookupError);
      return json(200, { ok: false, error: "submissions_lookup_failed" });
    }
    if (!pendingRows || pendingRows.length === 0) {
      console.log(
        `[NO_MATCH] No pending request for tier ${tierForAmount.key} ($${amount}) in the last ${MATCH_WINDOW_MIN}min.`,
      );
      return json(200, { ok: true, matched: false, reason: "no_pending_row" });
    }
    if (pendingRows.length > 1) {
      // Amount is the only thing to match on, so two people mid-purchase
      // on the same tier are indistinguishable. Refuse to guess — they
      // fall through to the receipt upload / manual admin approval.
      console.log(
        `[AMBIGUOUS] ${pendingRows.length} pending requests for tier ${tierForAmount.key}: ${pendingRows
          .map((r) => r.id)
          .join(", ")}`,
      );
      return json(200, { ok: true, matched: false, reason: "ambiguous" });
    }

    const sub = pendingRows[0];

    const stamp = {
      status: "approved",
      auto_approved: true,
      reviewed_at: new Date().toISOString(),
    };

    let updated: { id: string } | null = null;
    let updateErr: { message?: string } | null = null;

    ({ data: updated, error: updateErr } = await admin
      .from("payment_submissions")
      .update({ ...stamp, aba_trx_id: trxId, aba_payer: payer })
      .eq("id", sub.id)
      .eq("status", "pending") // guard against a race with the other confirm path
      .select("id")
      .maybeSingle());

    // Migration not run yet — retry without the two new columns so a
    // real payer is never left unconfirmed just because of a missing
    // ALTER TABLE.
    if (updateErr && /column .* does not exist/i.test(updateErr.message ?? "")) {
      console.warn("[MIGRATION] Run database/aba-trx-id-addition.sql — falling back.");
      ({ data: updated, error: updateErr } = await admin
        .from("payment_submissions")
        .update(stamp)
        .eq("id", sub.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle());
    }

    if (updateErr) {
      console.error("Update error:", updateErr);
      return json(200, { ok: false, error: "update_failed" });
    }
    if (!updated) {
      console.log(`[RACE] Request ${sub.id} was already confirmed by another path.`);
      return json(200, { ok: true, matched: false, reason: "already_confirmed" });
    }

    const { data: existing } = await admin
      .from("subscriptions")
      .select("expires_at")
      .eq("telegram_user_id", sub.telegram_user_id)
      .maybeSingle();

    const base =
      existing?.expires_at && new Date(existing.expires_at) > new Date()
        ? new Date(existing.expires_at)
        : new Date();
    // A plan's duration is sold in months but granted in DAYS, at a flat
    // 30 days per month (1 -> 30, 3 -> 90, 6 -> 180, 12 -> 360). Two
    // reasons this is not setMonth():
    //   1. It is the arithmetic the rest of the app already shows —
    //      UsersPanel's remaining-days bar divides by months * 30, and
    //      the plans are sold to viewers as a fixed day count.
    //   2. setMonth() silently overflows on long months: buying on
    //      31 Jan and adding 1 month lands on 3 Mar, because 31 Feb does
    //      not exist — the buyer quietly loses 3 days. Adding days can
    //      never do that.
    base.setDate(
      base.getDate() + (tierForAmount.months ?? TIER_MONTHS_FALLBACK[sub.tier] ?? 1) * 30,
    );

    await admin.from("subscriptions").upsert({
      telegram_user_id: sub.telegram_user_id,
      telegram_username: sub.telegram_username,
      tier: sub.tier,
      expires_at: base.toISOString(),
      updated_at: new Date().toISOString(),
    });

    console.log(
      `[SUCCESS] Auto-confirmed via direct ingest: ${sub.id} (tier: ${sub.tier}, $${amount})`,
    );

    const mainBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
    if (mainBotToken && adminChatId) {
      await tg(mainBotToken, "sendMessage", {
        chat_id: adminChatId,
        text:
          `⚡ Auto-confirmed (direct ABA notification)\n` +
          `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
          `📦 ${sub.tier} — $${amount}`,
      });
    }

    return json(200, { ok: true, matched: true, submission_id: sub.id, amount, trx_id: trxId });
  } catch (err) {
    console.error("aba-notify-ingest error:", err);
    return json(200, { ok: false, error: "unexpected" });
  }
});
