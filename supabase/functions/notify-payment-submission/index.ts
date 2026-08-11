import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Called directly from the client (SubscriptionModal -> lib/subscription.ts
// submitPayment) right after a payment_submissions row is inserted. Sends
// the admin the screenshot as a photo with the claimed amount/tier as the
// caption, plus Approve/Reject buttons — tapping one calls back into
// telegram-admin-bot's callback_query handler, which does the actual
// approve/reject (same place /ban and /unban live).
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_BOT_TOKEN     - same bot already used for episode notices
//   TELEGRAM_ADMIN_CHAT_ID - your personal Telegram chat id

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const TIER_LABEL: Record<string, string> = {
  "1m": "1 Month",
  "2m": "2 Months",
  "3m": "3 Months",
  "6m": "6 Months",
  "12m": "12 Months",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { submission_id, telegram_user_id, telegram_username, tier, amount, screenshot_url } = body;
    if (!submission_id || !telegram_user_id || !screenshot_url) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID")!;

    const caption =
      `💳 ការទូទាត់ថ្មី — ត្រូវការត្រួតពិនិត្យ\n\n` +
      `👤 ${telegram_username ? "@" + telegram_username : telegram_user_id}\n` +
      `🆔 ${telegram_user_id}\n` +
      `📦 ${TIER_LABEL[tier] ?? tier}\n` +
      `💵 $${amount}\n\n` +
      `សូមមើលរូបភាពខាងលើ រួចចុច Approve ឬ Reject`;

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: adminChatId,
        photo: screenshot_url,
        caption,
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `pay_approve:${submission_id}` },
            { text: "❌ Reject", callback_data: `pay_reject:${submission_id}` },
          ]],
        },
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      return new Response(JSON.stringify({ error: data.description }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
