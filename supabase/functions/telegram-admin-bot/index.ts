// =====================================================================
// !! THIS FILE IS BEHIND PRODUCTION -- DO NOT DEPLOY FROM IT !!
// ---------------------------------------------------------------------
// The live version of this function on Supabase project
// dowjxhkijtlsdvhyuddt is NEWER and has features this copy does not.
// Deploying this file would silently remove them.
//
// Before touching this function: open Supabase Dashboard -> Edge
// Functions -> this function -> copy the live source over this file
// FIRST, then make your change, then deploy.
//
// (This drift happened because several fixes were applied straight to
// the dashboard without being copied back into the repo.)
// =====================================================================

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

// Fallback only — live source of truth is pricing_tiers.months, editable
// from Admin Panel -> Subscriptions -> "Duration".
const TIER_MONTHS_FALLBACK: Record<string, number> = {
  "1m": 1,
  "2m": 2,
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

// Referral payout: fires once, on this viewer's FIRST approved payment
// only (referrals.rewarded starts false and this flips it, so a repeat
// customer's later renewals don't pay out again). Extends the
// referrer's own subscription the same way an approved payment extends
// the buyer's — from whichever is later, their current expires_at or
// now — using a reward length the admin controls via
// app_settings.referral_reward_days (see database/referral-addition.sql).
// Never throws: a missing/failed referral lookup just means no reward,
// not a failed payment approval.
async function rewardReferrerIfAny(
  admin: ReturnType<typeof createClient>,
  botToken: string,
  telegramUserId: string,
  submissionId: string,
) {
  try {
    const { data: referral } = await admin
      .from("referrals")
      .select("id, referrer_telegram_id, rewarded")
      .eq("referred_telegram_id", telegramUserId)
      .eq("rewarded", false)
      .maybeSingle();
    if (!referral) return;

    const { data: setting } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "referral_reward_days")
      .maybeSingle();
    const rewardDays = Number(setting?.value ?? 3) || 3;

    const { data: referrerSub } = await admin
      .from("subscriptions")
      .select("expires_at")
      .eq("telegram_user_id", referral.referrer_telegram_id)
      .maybeSingle();

    const base =
      referrerSub?.expires_at && new Date(referrerSub.expires_at) > new Date()
        ? new Date(referrerSub.expires_at)
        : new Date();
    base.setDate(base.getDate() + rewardDays);

    await admin.from("subscriptions").upsert({
      telegram_user_id: referral.referrer_telegram_id,
      expires_at: base.toISOString(),
      updated_at: new Date().toISOString(),
    });

    await admin
      .from("referrals")
      .update({
        rewarded: true,
        reward_days: rewardDays,
        rewarded_at: new Date().toISOString(),
        reward_submission_id: submissionId,
      })
      .eq("id", referral.id);

    // Best-effort notification — silently does nothing if this person
    // has never opened a chat with the bot (Telegram requires that
    // before a bot can message someone first).
    await tg(botToken, "sendMessage", {
      chat_id: referral.referrer_telegram_id,
      text: `🎉 មិត្តភ័ក្តិដែលអ្នកបានអញ្ជើញបានក្លាយជា VIP! អ្នកទទួលបាន VIP បន្ថែម ${rewardDays} ថ្ងៃដោយឥតគិតថ្លៃ។`,
    });
  } catch (err) {
    console.error("rewardReferrerIfAny failed:", err);
  }
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
          text:
            `ន kick/ban ចេញពី group\n` +
            `${user.username ? "@" + user.username : user.first_name ?? user.id}\n` +
            `${user.id}\n` +
            (actor ? `ធ្វើដោយ: ${actor.username ? "@" + actor.username : actor.id}\n` : ""),
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
          reply_markup: {
            inline_keyboard: [[{ text: "ជាវ VIP ឥឡូវនេះ", url: miniAppUrl }]],
          },
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (data === "show_preview") {
        await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id });
        const previewVideoUrl = Deno.env.get("TELEGRAM_PREVIEW_VIDEO_URL");
        const backButton = {
          inline_keyboard: [[{ text: "ត្រឡប់ទៅបង់ប្រាក់", url: miniAppUrl }]],
        };
        if (previewVideoUrl) {
          await tg(botToken, "sendVideo", {
            chat_id: callbackChatId,
            video: previewVideoUrl,
            caption: PREVIEW_TEXT,
            reply_markup: backButton,
          });
        } else {
          await tg(botToken, "sendMessage", {
            chat_id: callbackChatId,
            text: PREVIEW_TEXT,
            reply_markup: backButton,
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const [action, submissionId] = data.split(":");

      // Payment pings arrive two ways now: as a photo (receipt
      // attached) whose text lives in `caption`, or as a plain message
      // (viewer just tapped "Join VIP", no receipt yet) whose text
      // lives in `text`. editMessageCaption only works on the first
      // kind, so pick the matching edit method per message.
      const stampDecision = async (verdict: string) => {
        const original = cq.message?.caption ?? cq.message?.text ?? "";
        const isPhoto = typeof cq.message?.caption === "string";
        await tg(botToken, isPhoto ? "editMessageCaption" : "editMessageText", {
          chat_id: callbackChatId,
          message_id: cq.message.message_id,
          ...(isPhoto ? { caption: `${original}\n\n${verdict}` } : { text: `${original}\n\n${verdict}` }),
        });
      };

      if ((action === "pay_approve" || action === "pay_reject") && submissionId) {
        if (callbackChatId !== adminChatId) {
          await tg(botToken, "answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Not authorized.",
            show_alert: true,
          });
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: sub } = await admin
          .from("payment_submissions")
          .select("*")
          .eq("id", submissionId)
          .maybeSingle();

        if (!sub) {
          await tg(botToken, "answerCallbackQuery", {
            callback_query_id: cq.id,
            text: "Submission not found (already handled?).",
          });
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // A ticket the 3-minute timer closed (auto_expired) is still
        // approvable: the viewer may well have paid, and the admin is
        // often just slower than the timer. Only a real human decision
        // is final.
        const revivable = sub.status === "rejected" && sub.auto_expired === true;
        if (sub.status !== "pending" && !(action === "pay_approve" && revivable)) {
          await tg(botToken, "answerCallbackQuery", {
            callback_query_id: cq.id,
            text: `Already ${sub.status}.`,
          });
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (action === "pay_approve") {
          const { data: tierRow } = await admin
            .from("pricing_tiers")
            .select("months")
            .eq("key", sub.tier)
            .maybeSingle();
          const months = tierRow?.months ?? TIER_MONTHS_FALLBACK[sub.tier] ?? 1;

          const { data: existing } = await admin
            .from("subscriptions")
            .select("expires_at")
            .eq("telegram_user_id", sub.telegram_user_id)
            .maybeSingle();

          const base =
            existing?.expires_at && new Date(existing.expires_at) > new Date()
              ? new Date(existing.expires_at)
              : new Date();
          base.setMonth(base.getMonth() + months);

          await admin.from("subscriptions").upsert({
            telegram_user_id: sub.telegram_user_id,
            telegram_username: sub.telegram_username,
            tier: sub.tier,
            expires_at: base.toISOString(),
            updated_at: new Date().toISOString(),
          });
          await admin
            .from("payment_submissions")
            .update({ status: "approved", admin_confirmed: true, reviewed_at: new Date().toISOString() })
            .eq("id", submissionId);

          await rewardReferrerIfAny(admin, botToken, sub.telegram_user_id, submissionId);

          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Approved" });
          await stampDecision("✅ APPROVED");
        } else {
          await admin
            .from("payment_submissions")
            .update({ status: "rejected", admin_confirmed: true, reviewed_at: new Date().toISOString() })
            .eq("id", submissionId);

          await tg(botToken, "answerCallbackQuery", { callback_query_id: cq.id, text: "Rejected" });
          await stampDecision("❌ REJECTED");
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const msg = update.message;
    const text: string | undefined = msg?.text;
    const fromChatId = msg?.chat?.id ? String(msg.chat.id) : null;

    if (text === "/start" && fromChatId) {
      const bannerUrl = Deno.env.get("TELEGRAM_START_BANNER_URL");

      const keyboard = [
        [{ text: "🚀 OPEN APP", web_app: { url: miniAppUrl } }],
      ];

      if (bannerUrl) {
        await tg(botToken, "sendAnimation", {
          chat_id: fromChatId,
          animation: bannerUrl,
          caption: START_CAPTION,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard },
        });
      } else {
        await tg(botToken, "sendMessage", {
          chat_id: fromChatId,
          text: START_CAPTION,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (text && fromChatId === adminChatId) {
      const banMatch = text.match(/^\/ban\s+(\d+)\s*(.*)$/);
      const unbanMatch = text.match(/^\/unban\s+(\d+)\s*$/);

      if (banMatch) {
        const [, userId, reason] = banMatch;
        const result = await tg(botToken, "banChatMember", {
          chat_id: groupId,
          user_id: Number(userId),
        });

        if (result.ok) {
          await admin.from("ban_log").insert({
            telegram_user_id: userId,
            action: "banned",
            reason: reason || null,
            source: "admin_command",
            performed_by: fromChatId,
          });
          await tg(botToken, "sendMessage", {
            chat_id: adminChatId,
            text: `Ban user ${userId} success${reason ? ` (${reason})` : ""}`,
          });
        } else {
          await tg(botToken, "sendMessage", {
            chat_id: adminChatId,
            text: `Ban failed: ${result.description}`,
          });
        }
      } else if (unbanMatch) {
        const [, userId] = unbanMatch;
        const result = await tg(botToken, "unbanChatMember", {
          chat_id: groupId,
          user_id: Number(userId),
          only_if_banned: true,
        });

        if (result.ok) {
          await admin.from("ban_log").insert({
            telegram_user_id: userId,
            action: "unbanned",
            source: "admin_command",
            performed_by: fromChatId,
          });
          await tg(botToken, "sendMessage", {
            chat_id: adminChatId,
            text: `Unban user ${userId} success`,
          });
        } else {
          await tg(botToken, "sendMessage", {
            chat_id: adminChatId,
            text: `Unban failed: ${result.description}`,
          });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

const START_CAPTION =
  "🎬 <b>សូមស្វាគមន៍មកកាន់ NINT ANIME!</b>\n\n" +
  "ទស្សនា Animation ប្រែសម្លេងខ្មែរ គុណភាព HD 1080p ✨\n" +
  "ទទួលអារម្មណ៍ភ្លឺថ្លា ត្រជាក់ភ្នែក រលូន គ្មានការគាំង\n\n" +
  "📱 មិនចាំបាច់ចំណាយ storage ទូរស័ព្ទ ឬ data លើ Telegram ទាល់តែសោះ — មើលផ្ទាល់ក្នុង app បានតែម្ដង\n" +
  "🆓 មានរឿង Free ជាច្រើនឲ្យសាកមើលមុន\n" +
  "👑 ជាវ VIP ដោះសោគ្រប់រឿង/វគ្គថ្មីៗ HD ពេញលេញ\n" +
  "🔔 វគ្គថ្មីៗចេញរាល់ថ្ងៃ មិនចាំបាច់ស្វែងរកនៅកន្លែងផ្សេង\n\n" +
  "ចុចប៊ូតុងខាងក្រោម ដើម្បីចាប់ផ្តើមទស្សនា 👇";

const ABOUT_TEXT =
  "អំពី NINT ANIME\n\n" +
  "NINT ANIME ជាកន្លែងទស្សនាភាពយន្ត Anime HD ភាសាខ្មែរ\n\n" +
  "គុណភាព HD, ភាសាខ្មែរ, គ្មានប្រាក់, វគ្គថ្មីៗរាល់ថ្ងៃ, ចាប់រង្វាន់ថ្ងៃបន្ថែម នៅពេលទិញ VIP";

const PREVIEW_TEXT =
  "NINT ANIME — ជាមួយវគ្គថ្មីៗរាល់ថ្ងៃ គុណភាព HD គ្មានប្រាក់!\n\n" +
  "ចង់មើលពេញ? ទូទាត់ដើម្បីដោះសោ VIP ឥឡូវនេះ";
