import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Telegram webhook target for group ban/kick handling. Two things happen
// here, both logged to the `ban_log` table (see database/ban-log-addition.sql):
//
// 1. AUTO-LOG — Telegram sends a `chat_member` update to this webhook
//    whenever a member's status changes in the group (left, kicked,
//    banned, restricted, ...), *regardless of which bot or admin did it*,
//    as long as this bot is an admin in the group. When the new status is
//    "kicked", we log it and DM the configured admin so there's a record
//    even for bans performed by the other (unmanaged) admin bot.
//
// 2. DIRECT BAN — an admin can also message this bot directly (or in the
//    group) with `/ban <telegram_user_id> [reason]`. If the sender's chat
//    id matches TELEGRAM_ADMIN_CHAT_ID, the function calls Telegram's
//    banChatMember on TELEGRAM_GROUP_ID, logs it, and replies with the
//    result. `/unban <telegram_user_id>` works the same way in reverse.
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_BOT_TOKEN     - same bot already used for episode notices
//   TELEGRAM_GROUP_ID      - the VIP group's chat id (negative number)
//   TELEGRAM_ADMIN_CHAT_ID - your personal Telegram chat id, DM'd for
//                            every ban/kick and used to authorize /ban
//
// One-time setup after deploying this function (see chat for the full
// walkthrough): make the bot a group admin with "Ban users" checked, then
// register the webhook so Telegram actually calls this URL.

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

async function tg(botToken: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
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
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const update = await req.json();

    // ---------- 1. Auto-log any ban/kick, no matter who performed it ----------
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
            `🚫 សមាជិកត្រូវបាន kick/ban ចេញពី group\n` +
            `👤 ${user.username ? "@" + user.username : user.first_name ?? user.id}\n` +
            `🆔 ${user.id}\n` +
            (actor ? `ធ្វើដោយ: ${actor.username ? "@" + actor.username : actor.id}\n` : ""),
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- 2. /ban and /unban commands from the admin chat ----------
    const msg = update.message;
    const text: string | undefined = msg?.text;
    const fromChatId = msg?.chat?.id ? String(msg.chat.id) : null;

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
            text: `✅ Ban user ${userId} success${reason ? ` (${reason})` : ""}`,
          });
        } else {
          await tg(botToken, "sendMessage", {
            chat_id: adminChatId,
            text: `❌ Ban failed: ${result.description}`,
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
            text: `✅ Unban user ${userId} success`,
          });
        } else {
          await tg(botToken, "sendMessage", {
            chat_id: adminChatId,
            text: `❌ Unban failed: ${result.description}`,
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
