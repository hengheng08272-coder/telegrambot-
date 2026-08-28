import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Called by the client the moment a viewer attaches a payment screenshot
// (lib/subscription.ts attachScreenshotToSubmission), for the "ABA
// auto-match didn't fire yet, here's my proof" fallback path.
//
// Deliberate design choice (explicitly requested by the site owner,
// not a default I picked): grants VIP IMMEDIATELY on upload, same trust
// level as the ABA auto-match path, rather than waiting for an admin to
// eyeball the screenshot first. The tradeoff -- a screenshot alone is
// forgeable -- is accepted in exchange for the viewer never feeling
// stuck waiting. The safety net is retroactive, not preventive: this
// always sets auto_approved=true (never admin_confirmed), so every
// grant made this way lands in Admin Panel -> Payments "Needs
// confirmation" queue, and the admin's Telegram gets the actual photo
// with Confirm/Revoke buttons (see telegram-admin-bot's pay_confirm /
// pay_revoke handlers) -- revoking immediately ends the subscription.
//
// NOTE: this file was re-synced from the deployed function (the repo
// copy had drifted behind production), then given the claim-before-grant
// fix below.
//
// Required secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// TELEGRAM_ADMIN_CHAT_ID may hold more than one id, separated by commas or
// spaces ("111111,7777639689") — every id listed gets the same admin
// notifications, and a single id keeps behaving exactly as before.
function adminChatIds(): string[] {
  return (Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

const TIER_LABEL: Record<string, string> = {
  "1m": "1 Month",
  "2m": "2 Months",
  "3m": "3 Months",
  "6m": "6 Months",
  "12m": "12 Months",
};
const TIER_MONTHS_FALLBACK: Record<string, number> = { "1m": 1, "2m": 2, "3m": 3, "6m": 6, "12m": 12 };

async function tg(botToken: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const PROOF_RECEIVED_CAPTION = "\u{1F5BC}️ បានទទួលរូបភាពទូទាត់ — VIP ត្រូវបានផ្តល់រួចហើយ សូមផ្ទៀងផ្ទាត់វិញ";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { submission_id, screenshot_url } = await req.json();
    if (!submission_id || !screenshot_url) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: sub } = await admin.from("payment_submissions").select("*").eq("id", submission_id).maybeSingle();
    if (!sub) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (sub.status !== "pending") {
      return new Response(JSON.stringify({ ok: true, alreadyHandled: true, status: sub.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Claim the ticket BEFORE granting. This update used to run after the
    // subscription upsert, so when another path (the 30s client fallback,
    // an ABA notification, the admin's tap) approved the same ticket at
    // the same moment, both had already added a month — which is how a
    // one-month payment turned into 61 days. Exactly one caller can win
    // this UPDATE ... WHERE status = 'pending', and only the winner grants.
    const { data: claimed } = await admin
      .from("payment_submissions")
      .update({ screenshot_url, status: "approved", auto_approved: true, reviewed_at: new Date().toISOString() })
      .eq("id", submission_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!claimed) {
      // Someone else got there first — still attach the photo so the
      // admin can see what was sent.
      await admin.from("payment_submissions").update({ screenshot_url }).eq("id", submission_id);
      return new Response(JSON.stringify({ ok: true, alreadyHandled: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatIds = adminChatIds();
    if (botToken && chatIds.length > 0) {
      const caption =
        PROOF_RECEIVED_CAPTION + `\n\n` +
        `\u{1F464} ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
        `\u{1F194} ${sub.telegram_user_id}\n` +
        `\u{1F4E6} ${TIER_LABEL[sub.tier] ?? sub.tier} — $${sub.amount}`;
      for (const chatId of chatIds) {
        await tg(botToken, "sendPhoto", {
          chat_id: chatId,
          photo: screenshot_url,
          caption,
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Confirm", callback_data: `pay_confirm:${submission_id}` },
              { text: "⛔ Revoke", callback_data: `pay_revoke:${submission_id}` },
            ]],
          },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
