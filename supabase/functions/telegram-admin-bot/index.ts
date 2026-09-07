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

// TELEGRAM_ADMIN_CHAT_ID may hold more than one id, separated by commas or
// spaces ("111111,7777639689"). Every listed id receives the admin
// notices and may press the Approve/Reject buttons; a single id keeps
// behaving exactly as before.
function adminChatIds(): string[] {
  return (Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function isAdminChat(chatId: string | null): boolean {
  return chatId !== null && adminChatIds().includes(chatId);
}

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
    const chatIds = adminChatIds();
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

        for (const chatId of chatIds) {
          await tg(botToken, "sendMessage", {
            chat_id: chatId,
            text: KICK_NOTICE(user, actor),
          });
        }
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
        if (!isAdminChat(callbackChatId)) {
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
          // Claim the ticket in one atomic step before granting. Reading
          // the status and granting afterwards let the admin's tap and an
          // automatic path (ABA notification, the 30s fallback) both add
          // a month for a single payment.
          const { data: claimed } = await admin
            .from("payment_submissions")
            .update({ status: "approved", admin_confirmed: true, auto_expired: false, reviewed_at: new Date().toISOString() })
            .eq("id", submissionId)
            .in("status", revivable ? ["pending", "rejected"] : ["pending"])
            .select("id")
            .maybeSingle();

          if (!claimed) {
            await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Already handled." });
            return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }

          const { data: tierRow } = await admin.from("pricing_tiers").select("months").eq("key", sub.tier).maybeSingle();
          const months = tierRow?.months ?? TIER_MONTHS_FALLBACK[sub.tier] ?? 1;

          const { data: existing } = await admin.from("subscriptions").select("expires_at").eq("telegram_user_id", sub.telegram_user_id).maybeSingle();

          const base = existing?.expires_at && new Date(existing.expires_at) > new Date() ? new Date(existing.expires_at) : new Date();
          // A plan's duration is sold in months but granted in DAYS, at a
          // flat 30 days per month (1 -> 30, 3 -> 90, 6 -> 180, 12 -> 360).
          // Two reasons this is not setMonth():
          //   1. It is the arithmetic the rest of the app already shows --
          //      UsersPanel's remaining-days bar divides by months * 30,
          //      and the plans are sold as a fixed day count.
          //   2. setMonth() silently overflows on long months: buying on
          //      31 Jan and adding 1 month lands on 3 Mar, because 31 Feb
          //      does not exist -- the buyer quietly loses 3 days.
          base.setDate(base.getDate() + months * 30);

          await admin.from("subscriptions").upsert({
            telegram_user_id: sub.telegram_user_id,
            telegram_username: sub.telegram_username,
            tier: sub.tier,
            expires_at: base.toISOString(),
            updated_at: new Date().toISOString(),
          });

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
        if (!isAdminChat(callbackChatId)) {
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

      // movie_confirm / movie_revoke: same retroactive-review shape as
      // pay_confirm/pay_revoke above, but for a standalone $1 movie
      // purchase (movie_purchases table) instead of VIP. The unlock was
      // already granted optimistically by confirm-movie-payment-proof;
      // Confirm just marks it reviewed, Revoke actually takes the movie
      // back (sets status to rejected, which is what hasPurchasedMovie
      // checks against).
      if ((action === "movie_confirm" || action === "movie_revoke") && submissionId) {
        if (!isAdminChat(callbackChatId)) {
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Not authorized.", show_alert: true });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { data: sub } = await admin.from("movie_purchases").select("*").eq("id", submissionId).maybeSingle();

        if (!sub) {
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Purchase not found." });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (sub.admin_confirmed) {
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Already reviewed." });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (action === "movie_confirm") {
          await admin.from("movie_purchases").update({ admin_confirmed: true }).eq("id", submissionId);
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Confirmed" });
          await stampDecision("CONFIRMED");
        } else {
          await admin.from("movie_purchases").update({ status: "rejected", admin_confirmed: true, reviewed_at: new Date().toISOString() }).eq("id", submissionId);
          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Revoked — movie access removed." });
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
      const supportUrl =
        Deno.env.get("TELEGRAM_SUPPORT_URL") ||
        (adminUsername ? `https://t.me/${adminUsername}` : null);

      // A `url` button hands the address to the operating system, so iOS
      // stops to ask "Open link?" and then opens the Mini App as an
      // ordinary web page in the browser -- outside Telegram, with no
      // initData, so the viewer is not signed in. A `web_app` button
      // opens it in place inside Telegram.
      const isPrivateChat = msg?.chat?.type === "private";

      // Remember the follower.
      //
      // This is the only place the app ever learns that a person exists
      // as a bot user. Before it, /start replied and forgot: "how many
      // followers do I have" had no answer anywhere in the system, and
      // the Admin panel's "Watched today" was standing in for it while
      // actually counting episode plays -- so one viewer watching twenty
      // episodes read as twenty people.
      //
      // Keyed on the USER, not the chat: /start typed inside a group
      // arrives with chat.id = the group, so keying on the chat would
      // file an entire group as a single follower. Private chats only,
      // because a private /start is precisely what gives the bot
      // permission to message that person later -- a /start shouted in a
      // group grants no such permission and must not inflate the count.
      //
      // `started_at` is left out of the payload on purpose: PostgREST's
      // ON CONFLICT sets only the columns it is given, so the original
      // join date survives every later /start.
      //
      // Failure here is swallowed. The welcome message is what the
      // person came for; bookkeeping must never be the reason they get
      // silence instead.
      if (isPrivateChat && msg?.from?.id) {
        try {
          const { error: botUserError } = await admin.from("bot_users").upsert(
            {
              telegram_user_id: String(msg.from.id),
              telegram_username: msg.from.username ?? null,
              first_name: msg.from.first_name ?? null,
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: "telegram_user_id" },
          );
          if (botUserError) console.error("bot_users upsert failed:", botUserError.message);
        } catch (e) {
          console.error("bot_users upsert threw:", String(e));
        }
      }

      const openAppButton = isPrivateChat
        ? { text: OPEN_APP_BTN, web_app: { url: miniAppUrl } }
        : { text: OPEN_APP_BTN, url: miniAppUrl };

      const keyboard = [
        [openAppButton],
        supportUrl ? [{ text: SUPPORT_BTN, url: supportUrl }] : [],
      ].filter((row) => row.length > 0);

      if (bannerUrl) {
        await tg(botToken, "sendAnimation", { chat_id: fromChatId, animation: bannerUrl, caption: START_CAPTION, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
      } else {
        await tg(botToken, "sendMessage", { chat_id: fromChatId, text: START_CAPTION, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (text && isAdminChat(fromChatId)) {
      const banMatch = text.match(/^\/ban\s+(\d+)\s*(.*)$/);
      const unbanMatch = text.match(/^\/unban\s+(\d+)\s*$/);

      if (banMatch) {
        const [, userId, reason] = banMatch;
        const result = await tg(botToken, "banChatMember", { chat_id: groupId, user_id: Number(userId) });

        if (result.ok) {
          await admin.from("ban_log").insert({ telegram_user_id: userId, action: "banned", reason: reason || null, source: "admin_command", performed_by: fromChatId });
          await tg(botToken, "sendMessage", { chat_id: fromChatId, text: `Ban user ${userId} success${reason ? ` (${reason})` : ""}` });
        } else {
          await tg(botToken, "sendMessage", { chat_id: fromChatId, text: `Ban failed: ${result.description}` });
        }
      } else if (unbanMatch) {
        const [, userId] = unbanMatch;
        const result = await tg(botToken, "unbanChatMember", { chat_id: groupId, user_id: Number(userId), only_if_banned: true });

        if (result.ok) {
          await admin.from("ban_log").insert({ telegram_user_id: userId, action: "unbanned", source: "admin_command", performed_by: fromChatId });
          await tg(botToken, "sendMessage", { chat_id: fromChatId, text: `Unban user ${userId} success` });
        } else {
          await tg(botToken, "sendMessage", { chat_id: fromChatId, text: `Unban failed: ${result.description}` });
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
  return "ន kick/ban ចេញពី group\n" + who + "\n" + user.id + "\n" + (by ? "ធ្វើដោយ: " + by + "\n" : "");
}

const SUBSCRIBE_BTN = "ជាវ VIP";
const OPEN_APP_BTN = "បើក Mini App";
const SUPPORT_BTN = "💬 ជំនួយ / Support";
const BACK_TO_PAYMENT_BTN = "ត្រលប់ទៅបង់ប្រាក់";

const START_CAPTION =
  "សូមស្វាគមន៍មកកាន់ NINT ANIME!\n\n" +
  "មើលរួច Anime HD ភាសាខ្មែរ វគ្គថ្មីៗរាល់ថ្ងៃ\n\n" +
  "ជ្រើសរើសខាងក្រោម ដើម្បីចាប់ផ្តើម";

const ABOUT_TEXT =
  "អំពី NINT ANIME\n\n" +
  "NINT ANIME ជាកន្លែងទស្សនាភាពយន្ត Anime HD ភាសាខ្មែរ\n\n" +
  "គុណភាព HD, ភាសាខ្មែរ, គ្មានប្រាក់, វគ្គថ្មីៗរាល់ថ្ងៃ, ចាប់រង្វាន់ថ្ងៃបន្ថែម នៅពេលទិញ VIP";

const PREVIEW_TEXT =
  "NINT ANIME — ជាមួយវគ្គថ្មីៗរាល់ថ្ងៃ គុណភាព HD គ្មានប្រាក់!\n\n" +
  "ចង់មើលពេញ? ទូទាត់ដើម្បីដោសសោ VIP ឥឋូវនេះ";
