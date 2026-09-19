import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Called by the client the moment a viewer attaches a payment screenshot
// (lib/subscription.ts attachScreenshotToSubmission), for the "ABA
// auto-match didn't fire yet, here's my proof" fallback path.
//
// This function does NOT grant VIP.
//
// It used to: the receipt unlocked immediately and the admin reviewed it
// afterwards, which meant a convincing screenshot bought a month before
// anyone looked at the bank. The owner asked for that inverted — a
// receipt is now a REQUEST, and only a human turns it into a
// subscription. So all this does is attach the photo, leave the ticket
// `pending`, and put it in front of the admin.
//
// The buttons deliberately say pay_approve / pay_reject, not
// pay_confirm / pay_revoke. Those are two different handlers in
// telegram-admin-bot and the difference matters: pay_confirm means "VIP
// was already granted, I am reviewing it after the fact" and does not
// touch the subscription at all, so sending it here would have the admin
// tap Confirm and grant nothing. pay_approve IS the granting decision —
// it claims the pending row atomically and writes the subscription.
//
// The ABA notification path (aba-notify-ingest) is untouched and still
// auto-confirms: a real bank alert is evidence, a screenshot is a claim.
//
// Required secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

async function tg(botToken: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const PROOF_RECEIVED_CAPTION =
  "🖼️ បានទទួលរូបភាពទូទាត់ — រង់ចាំការបញ្ជាក់ពីអ្នកគ្រប់គ្រង";

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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: sub } = await admin.from("payment_submissions").select("*").eq("id", submission_id).maybeSingle();
    if (!sub) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Attach the photo whatever the state — if an ABA alert already
    // confirmed this ticket a second ago, the admin should still be able
    // to see what the viewer sent.
    await admin.from("payment_submissions").update({ screenshot_url }).eq("id", submission_id);

    if (sub.status !== "pending") {
      return new Response(JSON.stringify({ ok: true, alreadyHandled: true, status: sub.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatIds = adminChatIds();
    if (botToken && chatIds.length > 0) {
      const caption =
        PROOF_RECEIVED_CAPTION + `\n\n` +
        `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
        `🆔 ${sub.telegram_user_id}\n` +
        `📦 ${TIER_LABEL[sub.tier] ?? sub.tier} — $${sub.amount}`;
      for (const chatId of chatIds) {
        await tg(botToken, "sendPhoto", {
          chat_id: chatId,
          photo: screenshot_url,
          caption,
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Approve", callback_data: `pay_approve:${submission_id}` },
              { text: "⛔ Reject", callback_data: `pay_reject:${submission_id}` },
            ]],
          },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, granted: false, pending: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
