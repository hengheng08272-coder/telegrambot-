import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// =====================================================================
// Telegram webhook: auto-confirm VIP payments from ABA's own payment
// notifications, forwarded into a dedicated Telegram group by whatever
// notification-forwarder app/bot the admin already has running on the
// phone that holds the ABA account.
//
// This is a SEPARATE bot + webhook from telegram-admin-bot — it only
// ever listens, it's never given group-admin rights, and swapping which
// ABA account/group it watches is just three secrets (see below), no
// code change. Everything else (which QR shows, the price per tier, the
// pitch text) is already admin-editable from Admin Panel -> Subscriptions
// and is read live from the `pricing_tiers` table here too, so a price
// change there takes effect on auto-confirm immediately.
//
// MATCHING RULE: amount-only, fail-closed on ambiguity.
//   ABA's own KHQR "scan to pay" notification doesn't carry any
//   reference/note field through, so there's nothing to match on besides
//   the amount. Every plan already has a distinct price, so this is safe
//   AS LONG AS we refuse to guess when it's ambiguous: if two or more
//   'pending' submissions share the same amount within the match window,
//   neither gets auto-confirmed — they wait for the existing 30s
//   auto-approve fallback or an admin's manual Approve tap instead.
//
// SETUP (do this once per ABA account / notification group):
//   1. Create (or reuse) a bot via @BotFather, get its token. This can
//      be a brand new bot — it doesn't need to be the same bot as
//      TELEGRAM_BOT_TOKEN used elsewhere in this app.
//   2. In BotFather: /setprivacy -> Disable for this bot, so it can read
//      every message in the group, not just @mentions/commands.
//   3. Add the bot to the Telegram group that your notification-forwarder
//      posts ABA's payment alerts into.
//   4. Register the webhook (run once from a browser/Postman):
//        curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//          -d "url=https://dowjxhkijtlsdvhyuddt.supabase.co/functions/v1/aba-payment-webhook" \
//          -d "secret_token=<A LONG RANDOM STRING YOU PICK>"
//   5. Set these Supabase Edge Function secrets:
//        ABA_NOTIFY_BOT_TOKEN     = the token from step 1
//        ABA_NOTIFY_WEBHOOK_SECRET = the same secret_token from step 4
//        ABA_NOTIFY_GROUP_ID      = the notification group's chat id
//        ABA_NOTIFIER_ID          = sender id of whatever forwards ABA's
//                                   alerts into that group
//   6. Set the ABA account holder name in Admin Panel -> Subscriptions ->
//      "ABA Auto-confirm" (exactly as it's printed in real ABA
//      notifications) — this is the app_settings key aba_merchant_name.
//
// To point this whole thing at a DIFFERENT ABA account/group later:
// change ABA_NOTIFY_BOT_TOKEN, ABA_NOTIFY_GROUP_ID, ABA_NOTIFIER_ID (and
// re-run setWebhook with the new token) — nothing else needs to change.
// =====================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Bot-Api-Secret-Token",
};

// A pending request is only eligible for matching while it's this fresh
// — keeps an old abandoned 'pending' row from grabbing a much later,
// unrelated payment of the same amount. The client already auto-approves
// after 30s anyway, so this window just needs to comfortably cover a
// slow payer + forwarder delay, not act as the real timer.
const MATCH_WINDOW_MIN = 15;

// Matches "$3.00", "3.00$", "USD3.00", "3.00 USD" etc. and captures the
// numeric amount. ABA's notification format leads with "$X.XX" so this
// covers the real case; the extra alternatives are defensive.
const AMOUNT_PATTERN = /(?:\$|USD)\s*([0-9]+(?:\.[0-9]{1,2})?)|([0-9]+(?:\.[0-9]{1,2})?)\s*(?:\$|USD)/i;

function extractAmount(text: string): number | null {
  const m = AMOUNT_PATTERN.exec(text);
  if (!m) return null;
  const raw = m[1] ?? m[2];
  const value = Math.round(parseFloat(raw) * 100) / 100;
  return Number.isFinite(value) ? value : null;
}

const TIER_MONTHS: Record<string, number> = {
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
    // Best-effort only — never let a notify failure affect confirmation.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Always ack Telegram quickly with 200, even on internal problems, so
  // it doesn't sit there retrying the same update forever.
  const ack = () => new Response("ok", { status: 200, headers: corsHeaders });

  const webhookSecret = Deno.env.get("ABA_NOTIFY_WEBHOOK_SECRET");
  const groupId = Deno.env.get("ABA_NOTIFY_GROUP_ID");
  const notifierId = Deno.env.get("ABA_NOTIFIER_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (webhookSecret) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== webhookSecret) {
      return new Response("forbidden", { status: 403, headers: corsHeaders });
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return ack();
  }

  const message = body.message ?? body.channel_post;
  if (!message) return ack();

  const chatId: number | undefined = message.chat?.id;
  const fromId: number | undefined = message.from?.id ?? message.sender_chat?.id;
  const text: string = message.text ?? message.caption ?? "";
  if (!text) return ack();

  // Only trust messages from the configured group / sender once those
  // secrets are set. Until they are, every update is a silent no-op —
  // set ABA_NOTIFY_GROUP_ID / ABA_NOTIFIER_ID as step 5 above.
  if (groupId && String(chatId) !== groupId) {
    console.log(`[FILTER] Chat ID mismatch: ${chatId} vs ${groupId}`);
    return ack();
  }
  if (notifierId && String(fromId) !== notifierId) {
    console.log(`[FILTER] Sender ID mismatch: ${fromId} vs ${notifierId}`);
    return ack();
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    // Merchant name is admin-editable (Admin Panel -> Subscriptions),
    // not hardcoded, so swapping ABA accounts never needs a code change.
    const { data: nameRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "aba_merchant_name")
      .maybeSingle();
    const merchantName = (nameRow?.value ?? "").trim().toUpperCase();

    if (!merchantName || !text.toUpperCase().includes(merchantName)) {
      console.log("[NO_MATCH] Merchant name not set or not found in message; skipping.");
      return ack();
    }

    const amount = extractAmount(text);
    console.log(`Extracted amount: ${amount}`);
    if (amount === null) {
      console.log(`[NO_MATCH] No usable amount in: "${text}"`);
      return ack();
    }

    // Valid amounts come live from pricing_tiers, not a hardcoded list —
    // a price change in Admin Panel -> Subscriptions takes effect here
    // immediately, no redeploy.
    const { data: tiers, error: tiersErr } = await admin
      .from("pricing_tiers")
      .select("key, price");
    if (tiersErr) {
      console.error("pricing_tiers lookup error:", tiersErr);
      return ack();
    }
    const tierForAmount = (tiers ?? []).find((t) => Number(t.price) === amount);
    if (!tierForAmount) {
      console.log(`[NO_MATCH] $${amount} doesn't match any current plan price.`);
      return ack();
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
      return ack();
    }
    if (!pendingRows || pendingRows.length === 0) {
      console.log(`[NO_MATCH] No pending request for tier ${tierForAmount.key} ($${amount}) in the last ${MATCH_WINDOW_MIN}min.`);
      return ack();
    }
    if (pendingRows.length > 1) {
      // More than one pending request at this exact price right now —
      // refuse to guess which payer this notification belongs to. They
      // fall back to the 30s auto-approve or an admin's manual review.
      console.log(`[AMBIGUOUS] ${pendingRows.length} pending requests for tier ${tierForAmount.key}: ${pendingRows.map((r) => r.id).join(", ")}`);
      return ack();
    }

    const sub = pendingRows[0];

    const { data: updated, error: updateErr } = await admin
      .from("payment_submissions")
      .update({ status: "approved", auto_approved: true, reviewed_at: new Date().toISOString() })
      .eq("id", sub.id)
      .eq("status", "pending") // guard against a race with another confirmation path
      .select("id")
      .maybeSingle();

    if (updateErr) {
      console.error("Update error:", updateErr);
      return ack();
    }
    if (!updated) {
      console.log(`[RACE] Request ${sub.id} may have already been confirmed by another process`);
      return ack();
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
    base.setMonth(base.getMonth() + (TIER_MONTHS[sub.tier] ?? 1));

    await admin.from("subscriptions").upsert({
      telegram_user_id: sub.telegram_user_id,
      telegram_username: sub.telegram_username,
      tier: sub.tier,
      expires_at: base.toISOString(),
      updated_at: new Date().toISOString(),
    });

    console.log(`[SUCCESS] Auto-confirmed via ABA notification: ${sub.id} (tier: ${sub.tier}, $${amount})`);

    // Notify the admin on the MAIN bot/chat — same one telegram-admin-bot
    // already DMs for manual approvals — so this stays visible even
    // though no tap was needed this time.
    const mainBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
    if (mainBotToken && adminChatId) {
      await tg(mainBotToken, "sendMessage", {
        chat_id: adminChatId,
        text:
          `⚡ Auto-confirmed via ABA notification\n` +
          `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
          `📦 ${sub.tier} — $${amount}`,
      });
    }

    return ack();
  } catch (err) {
    console.error("aba-payment-webhook error:", err);
    return ack();
  }
});
