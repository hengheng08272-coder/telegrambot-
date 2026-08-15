import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// =====================================================================
// Telegram webhook: auto-confirm VIP payments from ABA's own payment
// notifications, forwarded into a dedicated Telegram group.
//
// !! HARD TELEGRAM LIMIT — READ THIS IF NOTHING EVER MATCHES !!
//   Telegram bots NEVER receive messages sent by another bot, in any
//   chat, regardless of privacy mode or admin rights (core.telegram.org
//   /bots/faq). So if the thing posting ABA's alerts into the group is
//   itself a bot, this webhook will never see those messages and no
//   amount of config will fix it. Working relays, best first:
//     A. Point the phone's notification-forwarder app at the plain HTTPS
//        endpoint `aba-notify-ingest` instead of at Telegram. No bots
//        involved at all — this is the recommended fix.
//     B. Have the forwarder bot post into a CHANNEL, link that channel
//        to this group as its discussion group, and let Telegram
//        auto-forward the post in. The copy that lands in the group is
//        attributed to the channel (not to a bot), so this webhook does
//        receive it (is_automatic_forward = true).
//     C. Run a userbot (a real Telegram account via Telethon/Pyrogram)
//        that reads the bot's messages and relays them.
//   See ABA_AUTO_CONFIRM_FORWARD_GUIDE.md for the full walkthrough.
//
// MATCHING RULE: amount-only, fail-closed on ambiguity. Every plan has a
// distinct price, so this is safe as long as we refuse to guess when two
// pending submissions share the same amount.
// =====================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Telegram-Bot-Api-Secret-Token",
};

const MATCH_WINDOW_MIN = 15;

const AMOUNT_PATTERN = /(?:\$|USD)\s*([0-9]+(?:\.[0-9]{1,2})?)|([0-9]+(?:\.[0-9]{1,2})?)\s*(?:\$|USD)/i;

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
// Unique per real payment — the only reliable replay guard here.
const TRX_ID_PATTERN = /Trx\.?\s*ID\s*[:#]?\s*([0-9]{6,})/i;
const PAYER_PATTERN = /paid\s+by\s+(.+?)\s+on\s+/i;

function extractTrxId(text: string): string | null {
  const m = TRX_ID_PATTERN.exec(text);
  return m ? m[1] : null;
}

function extractPayer(text: string): string | null {
  const m = PAYER_PATTERN.exec(text);
  return m ? m[1].trim().slice(0, 120) : null;
}

const TIER_MONTHS_FALLBACK: Record<string, number> = { "1m": 1, "2m": 2, "3m": 3, "6m": 6, "12m": 12 };

async function tg(token: string, method: string, body: Record<string, unknown>) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Best-effort only.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

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

  // Accept every shape the ABA alert can arrive in.
  const message =
    body.message ?? body.channel_post ?? body.edited_message ?? body.edited_channel_post;
  if (!message) return ack();

  const chatId: number | undefined = message.chat?.id;
  const text: string = message.text ?? message.caption ?? "";

  // Every id this update could legitimately be "from". A plain post has
  // only message.from; a channel post has sender_chat; an auto-forward
  // from a linked channel arrives with from.id = 777000 (Telegram
  // itself) and the real origin in forward_from_chat / forward_origin;
  // a userbot-relayed message has the userbot in from and the original
  // bot/channel in forward_from / forward_origin.
  const senderIds: string[] = [
    message.from?.id,
    message.sender_chat?.id,
    message.forward_from?.id,
    message.forward_from_chat?.id,
    message.forward_origin?.chat?.id,
    message.forward_origin?.sender_chat?.id,
    message.forward_origin?.sender_user?.id,
  ]
    .filter((v) => v !== undefined && v !== null)
    .map((v) => String(v));

  // Printed on EVERY update, before any filtering, so the exact values to
  // put in ABA_NOTIFY_GROUP_ID / ABA_NOTIFIER_ID can be read off the logs
  // after one test message.
  console.log(
    `[IDS] chat=${chatId} senders=[${senderIds.join(",")}]` +
      ` auto_forward=${message.is_automatic_forward === true}` +
      ` via_bot=${message.via_bot?.username ?? "-"}` +
      ` text="${text.slice(0, 120)}"`,
  );

  if (!text) return ack();

  // Both filters accept a comma-separated list. Set either to "any" (or
  // leave unset) to skip that check — the merchant-name + amount +
  // pending-row checks below still have to pass.
  const idList = (raw: string | undefined) =>
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const allowedChats = idList(groupId);
  const allowedSenders = idList(notifierId);
  const isAny = (list: string[]) =>
    list.length === 0 || list.some((v) => v === "any" || v === "*");

  if (!isAny(allowedChats) && !allowedChats.includes(String(chatId))) {
    console.log(`[FILTER] Chat ${chatId} not in ABA_NOTIFY_GROUP_ID (${groupId})`);
    return ack();
  }
  if (!isAny(allowedSenders) && !senderIds.some((id) => allowedSenders.includes(id))) {
    console.log(`[FILTER] None of [${senderIds.join(",")}] is in ABA_NOTIFIER_ID (${notifierId})`);
    return ack();
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
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

    const { data: tiers, error: tiersErr } = await admin
      .from("pricing_tiers")
      .select("key, price, months");
    if (tiersErr) {
      console.error("pricing_tiers lookup error:", tiersErr);
      return ack();
    }
    const tierForAmount = (tiers ?? []).find((t) => Number(t.price) === amount);
    if (!tierForAmount) {
      console.log(`[NO_MATCH] $${amount} doesn't match any current plan price.`);
      return ack();
    }

    const trxId = extractTrxId(text);
    const payer = extractPayer(text);
    console.log(`[PARSED] amount=${amount} trx=${trxId ?? "-"} payer=${payer ?? "-"}`);

    // Replay guard. A missing column here just means the migration has
    // not been run; warn loudly rather than failing a real payment.
    if (trxId) {
      const { data: seen, error: seenErr } = await admin
        .from("payment_submissions")
        .select("id")
        .eq("aba_trx_id", trxId)
        .maybeSingle();
      if (seenErr) {
        console.warn(
          `[MIGRATION] Could not check aba_trx_id (${seenErr.message}). Run database/aba-trx-id-addition.sql.`,
        );
      } else if (seen) {
        console.log(`[DUPLICATE] Trx ${trxId} was already applied to ${seen.id}; ignoring.`);
        return ack();
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
      return ack();
    }
    if (!pendingRows || pendingRows.length === 0) {
      console.log(`[NO_MATCH] No pending request for tier ${tierForAmount.key} ($${amount}) in the last ${MATCH_WINDOW_MIN}min.`);
      return ack();
    }
    if (pendingRows.length > 1) {
      console.log(`[AMBIGUOUS] ${pendingRows.length} pending requests for tier ${tierForAmount.key}: ${pendingRows.map((r) => r.id).join(", ")}`);
      return ack();
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
      .eq("status", "pending")
      .select("id")
      .maybeSingle());

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
    base.setMonth(base.getMonth() + (tierForAmount.months ?? TIER_MONTHS_FALLBACK[sub.tier] ?? 1));

    await admin.from("subscriptions").upsert({
      telegram_user_id: sub.telegram_user_id,
      telegram_username: sub.telegram_username,
      tier: sub.tier,
      expires_at: base.toISOString(),
      updated_at: new Date().toISOString(),
    });

    console.log(`[SUCCESS] Auto-confirmed via ABA notification: ${sub.id} (tier: ${sub.tier}, $${amount})`);

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
