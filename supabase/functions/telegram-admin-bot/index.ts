import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}

const TIER_MONTHS_FALLBACK: Record<string, number> = { "1m": 1, "2m": 2, "3m": 3, "6m": 6, "12m": 12 };

async function tg(botToken: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram API ${method} failed:`, JSON.stringify(data), "| sent body:", JSON.stringify(body));
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const groupId = Deno.env.get("TELEGRAM_GROUP_ID")!;
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID")!;
    const miniAppUrl = Deno.env.get("TELEGRAM_MINIAPP_URL")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const update = await req.json();

    if (update.chat_member) {
      const cm = update.chat_member;
      const newStatus = cm.new_chat_member?.status;
      const user: TgUser = cm.new_chat_member?.user ?? {};
      const actor: TgUser | undefined = cm.from;

      if (newStatus === "kicked") {
        await admin.from("ban_log").insert({
          telegram_user_id: String(user.id),
          telegram_username: user.username ?? user.first_name ?? null,
          action: "kicked_auto",
          source: "chat_member_event",
          performed_by: actor?.username ?? (actor ? String(actor.id) : null),
        });

        await tg(botToken, "sendMessage", {
          chat_id: adminChatId,
          text: KICK_NOTICE(user, actor),
        });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const data: string = cq.data ?? "";
      const callbackChatId = cq.message?.chat?.id ? String(cq.message.chat.id) : null;

      if (data === "show_about") {
        await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id });
        await tg(botToken, "sendMessage", {
          chat_id: callbackChatId,
          parse_mode: "HTML",
          text: ABOUT_TEXT,
          reply_markup: { inline_keyboard: [[{ text: SUBSCRIBE_BTN, url: miniAppUrl }]] },
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (data === "show_preview") {
        await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id });
        const previewVideoUrl = Deno.env.get("TELEGRAM_PREVIEW_VIDEO_URL");
        const backButton = { inline_keyboard: [[{ text: BACK_TO_PAYMENT_BTN, url: miniAppUrl }]] };
        if (previewVideoUrl) {
          await tg(botToken, "sendVideo", { chat_id: callbackChatId, video: previewVideoUrl, caption: PREVIEW_TEXT, reply_markup: backButton });
        } else {
          await tg(botToken, "sendMessage", { chat_id: callbackChatId, text: PREVIEW_TEXT, reply_markup: backButton });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const [action, submissionId] = data.split(":");

      // Payment pings arrive in two shapes now: as a photo (receipt
      // attached) whose text lives in `caption`, and as a plain message
      // (viewer just tapped "Join VIP", no receipt yet) whose text lives
      // in `text`. editMessageCaption only works on the first kind, so
      // stamping the verdict has to pick the matching edit method --
      // otherwise the approval succeeds but the message never visibly
      // updates, which reads to the admin like the button did nothing.
      const stampDecision = async (verdict: string) => {
        const original = cq.message?.caption ?? cq.message?.text ?? "";
        const isPhoto = typeof cq.message?.caption === "string";
        await tg(botToken, isPhoto ? "editMessageCaption" : "editMessageText", {
          chat_id: callbackChatId,
          message_id: cq.message.message_id,
          ...(isPhoto ? { caption: `${original}\n\n${verdict}` } : { text: `${original}\n\n${verdict}` }),
        });
      };

      // pay_approve / pay_reject: submission is still genuinely pending --
      // nothing has been granted yet, this IS the approval decision.
      if ((action === "pay_approve" || action === "pay_reject") && submissionId) {
        if (callbackChatId !== adminChatId) {
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Not authorized.", show_alert: true });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { data: sub } = await admin.from("payment_submissions").select("*").eq("id", submissionId).maybeSingle();

        if (!sub) {
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Submission not found (already handled?)." });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // A ticket closed by the 3-minute listening timer (auto_expired)
        // is still approvable: the viewer may well have paid, and the
        // admin is often just slower than the timer. Only a real human
        // decision is final -- without this, checking the bank statement
        // a few minutes late would strand a genuine payer on "Already
        // rejected."
        const revivable = sub.status === "rejected" && sub.auto_expired === true && !sub.admin_confirmed;
        if (sub.status !== "pending" && !(action === "pay_approve" && revivable)) {
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: `Already ${sub.status}.` });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (action === "pay_approve") {
          const { data: tierRow } = await admin.from("pricing_tiers").select("months").eq("key", sub.tier).maybeSingle();
          const months = tierRow?.months ?? TIER_MONTHS_FALLBACK[sub.tier] ?? 1;

          const { data: existing } = await admin.from("subscriptions").select("expires_at").eq("telegram_user_id", sub.telegram_user_id).maybeSingle();

          const base = existing?.expires_at && new Date(existing.expires_at) > new Date() ? new Date(existing.expires_at) : new Date();
          base.setMonth(base.getMonth() + months);

          await admin.from("subscriptions").upsert({
            telegram_user_id: sub.telegram_user_id,
            telegram_username: sub.telegram_username,
            tier: sub.tier,
            expires_at: base.toISOString(),
            updated_at: new Date().toISOString(),
          });
          await admin.from("payment_submissions").update({ status: "approved", admin_confirmed: true, auto_expired: false, reviewed_at: new Date().toISOString() }).eq("id", submissionId);

          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: revivable ? "Approved (reopened)" : "Approved" });
          await stampDecision("APPROVED");
        } else {
          await admin.from("payment_submissions").update({ status: "rejected", admin_confirmed: true, reviewed_at: new Date().toISOString() }).eq("id", submissionId);

          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Rejected" });
          await stampDecision("REJECTED");
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // pay_confirm / pay_revoke: VIP was ALREADY granted (ABA auto-match
      // or confirm-payment-proof on screenshot upload) -- this is a
      // retroactive review, not the original decision. Confirm is a
      // no-op on the subscription itself (just marks reviewed); Revoke
      // actually ends the subscription right now, mirroring
      // PaymentsPanel's confirmAuto/revokeAuto so both entry points
      // (Telegram buttons and the Admin Panel) behave identically.
      if ((action === "pay_confirm" || action === "pay_revoke") && submissionId) {
        if (callbackChatId !== adminChatId) {
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Not authorized.", show_alert: true });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { data: sub } = await admin.from("payment_submissions").select("*").eq("id", submissionId).maybeSingle();

        if (!sub) {
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Submission not found." });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (sub.admin_confirmed) {
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Already reviewed." });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (action === "pay_confirm") {
          await admin.from("payment_submissions").update({ admin_confirmed: true }).eq("id", submissionId);
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Confirmed" });
          await stampDecision("CONFIRMED");
        } else {
          await admin.from("subscriptions").update({ expires_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("telegram_user_id", sub.telegram_user_id);
          await admin.from("payment_submissions").update({ status: "rejected", admin_confirmed: true, reviewed_at: new Date().toISOString() }).eq("id", submissionId);
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Revoked -- VIP ended." });
          await stampDecision("REVOKED");
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const msg = update.message;
    const text: string | undefined = msg?.text;
    const fromChatId = msg?.chat?.id ? String(msg.chat.id) : null;

    if (text === "/start" && fromChatId) {
      const adminUsername = Deno.env.get("TELEGRAM_ADMIN_USERNAME");
      const bannerUrl = Deno.env.get("TELEGRAM_START_BANNER_URL");

      const keyboard = [
        [{ text: SUBSCRIBE_BTN, url: miniAppUrl }, { text: OPEN_APP_BTN, url: miniAppUrl }],
        [{ text: ABOUT_US_BTN, callback_data: "show_about" }, { text: "Preview", callback_data: "show_preview" }],
        adminUsername ? [{ text: CONTACT_US_BTN, url: `https://t.me/${adminUsername}` }] : [],
      ].filter((row) => row.length > 0);

      if (bannerUrl) {
        await tg(botToken, "sendAnimation", { chat_id: fromChatId, animation: bannerUrl, caption: START_CAPTION, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
      } else {
        await tg(botToken, "sendMessage", { chat_id: fromChatId, text: START_CAPTION, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (text && fromChatId === adminChatId) {
      const banMatch = text.match(/^\/ban\s+(\d+)\s*(.*)$/);
      const unbanMatch = text.match(/^\/unban\s+(\d+)\s*$/);

      if (banMatch) {
        const [, userId, reason] = banMatch;
        const result = await tg(botToken, "banChatMember", { chat_id: groupId, user_id: Number(userId) });

        if (result.ok) {
          await admin.from("ban_log").insert({ telegram_user_id: userId, action: "banned", reason: reason || null, source: "admin_command", performed_by: fromChatId });
          await tg(botToken, "sendMessage", { chat_id: adminChatId, text: `Ban user ${userId} success${reason ? ` (${reason})` : ""}` });
        } else {
          await tg(botToken, "sendMessage", { chat_id: adminChatId, text: `Ban failed: ${result.description}` });
        }
      } else if (unbanMatch) {
        const [, userId] = unbanMatch;
        const result = await tg(botToken, "unbanChatMember", { chat_id: groupId, user_id: Number(userId), only_if_banned: true });

        if (result.ok) {
          await admin.from("ban_log").insert({ telegram_user_id: userId, action: "unbanned", source: "admin_command", performed_by: fromChatId });
          await tg(botToken, "sendMessage", { chat_id: adminChatId, text: `Unban user ${userId} success` });
        } else {
          await tg(botToken, "sendMessage", { chat_id: adminChatId, text: `Unban failed: ${result.description}` });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

function KICK_NOTICE(user: TgUser, actor?: TgUser) {
  const who = user.username ? "@" + user.username : (user.first_name ?? String(user.id));
  const by = actor ? (actor.username ? "@" + actor.username : String(actor.id)) : null;
  return "\u1793 kick/ban \u1785\u17c1\u1789\u1796\u17b8 group\n" + who + "\n" + user.id + "\n" + (by ? "\u1792\u17d2\u179c\u17be\u178a\u17c4\u1799: " + by + "\n" : "");
}

const SUBSCRIBE_BTN = "\u1787\u17b6\u179c VIP";
const OPEN_APP_BTN = "\u1794\u17be\u1780 Mini App";
const ABOUT_US_BTN = "\u17a2\u17c6\u1796\u17b8\u1799\u17be\u1784";
const CONTACT_US_BTN = "\u1791\u17b6\u1780\u17cb\u1791\u1784\u1780\u17d2\u179a\u17bb\u1798\u1780\u17b6\u179a\u1784\u17b6\u179a";
const BACK_TO_PAYMENT_BTN = "\u178f\u17d2\u179a\u179b\u1794\u17cb\u1791\u17c5\u1794\u1784\u17cb\u1794\u17d2\u179a\u17b6\u1780\u17cb";

const START_CAPTION =
  "\u179f\u17bc\u1798\u179f\u17d2\u179c\u17b6\u1782\u1798\u1793\u17cd\u1798\u1780\u1780\u17b6\u1793\u17cb NINT ANIME!\n\n" +
  "\u1798\u17be\u179b\u179a\u17bd\u1785 Anime HD \u1797\u17b6\u179f\u17b6\u1781\u17d2\u1798\u17c2\u179a \u179c\u1782\u17d2\u1782\u1790\u17d2\u1798\u17b8\u17d7\u179a\u17b6\u179b\u17cb\u1790\u17d2\u1784\u17c3\n\n" +
  "\u1787\u17d2\u179a\u17be\u179f\u179a\u17be\u179f\u1781\u17b6\u1784\u1780\u17d2\u179a\u17c4\u1798 \u178a\u17be\u1798\u17d2\u1794\u17b8\u1785\u17b6\u1794\u17cb\u1795\u17d2\u178f\u17be\u1798";

const ABOUT_TEXT =
  "\u17a2\u17c6\u1796\u17b8 NINT ANIME\n\n" +
  "NINT ANIME \u1787\u17b6\u1780\u1793\u17d2\u179b\u17c2\u1784\u1791\u179f\u17d2\u179f\u1793\u17b6\u1797\u17b6\u1796\u1799\u1793\u17d2\u178f Anime HD \u1797\u17b6\u179f\u17b6\u1781\u17d2\u1798\u17c2\u179a\n\n" +
  "\u1782\u17bb\u178e\u1797\u17b6\u1796 HD, \u1797\u17b6\u179f\u17b6\u1781\u17d2\u1798\u17c2\u179a, \u1782\u17d2\u1798\u17b6\u1793\u1794\u17d2\u179a\u17b6\u1780\u17cb, \u179c\u1782\u17d2\u1782\u1790\u17d2\u1798\u17b8\u17d7\u179a\u17b6\u179b\u17cb\u1790\u17d2\u1784\u17c3, \u1785\u17b6\u1794\u17cb\u179a\u1784\u17d2\u179c\u17b6\u1793\u17cb\u1790\u17d2\u1784\u17c3\u1794\u1793\u17d2\u1790\u17c2\u1798 \u1793\u17c5\u1796\u17c1\u179b\u1791\u17b7\u1789 VIP";

const PREVIEW_TEXT =
  "NINT ANIME \u2014 \u1787\u17b6\u1798\u17bd\u1799\u179c\u1782\u17d2\u1782\u1790\u17d2\u1798\u17b8\u17d7\u179a\u17b6\u179b\u17cb\u1790\u17d2\u1784\u17c3 \u1782\u17bb\u178e\u1797\u17b6\u1796 HD \u1782\u17d2\u1798\u17b6\u1793\u1794\u17d2\u179a\u17b6\u1780\u17cb!\n\n" +
  "\u1785\u1784\u17cb\u1798\u17be\u179b\u1796\u17c1\u1789? \u1791\u17bc\u1791\u17b6\u178f\u17cb\u178a\u17be\u1798\u17d2\u1794\u17b8\u178a\u17c4\u179f\u179f\u17c4 VIP \u17a5\u178b\u17bc\u179c\u1793\u17c1\u17c7";
