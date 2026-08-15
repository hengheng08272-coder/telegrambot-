import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Called directly from the client (SubscriptionModal -> lib/subscription.ts
// submitPaymentIntent) right after a payment_submissions row is
// inserted. Sends the admin an Approve/Reject notification -- tapping one
// calls back into telegram-admin-bot's callback_query handler, which does
// the actual approve/reject (same place /ban and /unban live).
//
// Two shapes: the screenshot-proof flow sends the image as a photo
// (sendPhoto); the "tap Join VIP, no screenshot yet" flow has no image to
// attach, so it sends a plain text message instead (sendMessage) with the
// same body + buttons. Either way the admin can still decide by hand as
// the fallback if the ABA auto-match never fires.
//
// `reason` only changes the wording, never the behaviour:
//   joined  - viewer just tapped "Join VIP"; a 3-minute listening window
//             is running, so the admin usually doesn't need to act yet
//   timeout - that window closed with nothing matched
//   proof   - a receipt was attached
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_BOT_TOKEN     - same bot already used for episode notices
//   TELEGRAM_ADMIN_CHAT_ID - your personal Telegram chat id

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const { submission_id, telegram_user_id, telegram_username, tier, amount, screenshot_url, reason } = body;
    if (!submission_id || !telegram_user_id) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID")!;

    const headline =
      reason === "joined"
        ? "🔔 សំបុត្រទូទាត់ថ្មី — អ្នកប្រើចុច «ចូលសមាជិត VIP»\n\n"
        : reason === "proof"
          ? "🧾 អ្នកប្រើបានផ្ញើវិក្កយបត្រ\n\n"
          : screenshot_url
            ? "💳 ការទូទាត់ថ្មី — ត្រូវការត្រួតពិនិត្យ\n\n"
            : "💳 ការទូទាត់ថ្មី (គ្មានរូបភាព) — សូមពិនិត្យបញ្ជី ABA ដោយផ្ទាល់\n\n";

    const footer = screenshot_url
      ? "សូមមើលរូបភាពខាងលើ រួចចុច Approve ឬ Reject"
      : reason === "joined"
        ? "ប្រព័ន្ធកំពុងរង់ចាំសារពី ABA រយៈពេល ៣ នាទី។ បើ ABA បញ្ជាក់ ឬអ្នកប្រើផ្ញើវិក្កយបត្រ វានឹងដោះសោដោយស្វ័យប្រវត្តិ។ បើគ្មានទេ សំបុត្រនេះនឹងបិទដោយខ្លួនឯង — តែអ្នកនៅតែអាចចុច Approve បានក្រោយពេលនោះ។"
        : "សូមផ្ទៀងផ្ទាត់ statement ធនាគាររបស់អ្នក រួចចុច Approve ឬ Reject";

    const caption =
      headline +
      `👤 ${telegram_username ? "@" + telegram_username : telegram_user_id}\n` +
      `🆔 ${telegram_user_id}\n` +
      `📦 ${TIER_LABEL[tier] ?? tier}\n` +
      `💵 $${amount}\n\n` +
      footer;

    const replyMarkup = {
      inline_keyboard: [[
        { text: "✅ Approve", callback_data: `pay_approve:${submission_id}` },
        { text: "❌ Reject", callback_data: `pay_reject:${submission_id}` },
      ]],
    };

    let res: Response;
    if (screenshot_url) {
      res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: adminChatId, photo: screenshot_url, caption, reply_markup: replyMarkup }),
      });
    } else {
      res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: adminChatId, text: caption, reply_markup: replyMarkup }),
      });
    }

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
