import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
//   TELEGRAM_ADMIN_CHAT_ID - extra recipients (a group chat, or anyone
//                            who is not in admin_users). Optional now.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - to read admin_users

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Everyone who should see a payment land.
 *
 * admin_users is the source of truth, so adding an administrator there
 * puts them on these notifications with no second place to remember.
 * TELEGRAM_ADMIN_CHAT_ID is merged in rather than replaced, because a
 * group chat — or a recipient who is not an administrator — still has
 * to work. Deduped: the owner is normally in both.
 */
async function adminChatIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (const raw of (Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "").split(/[,\s]+/)) {
    const id = raw.trim();
    if (id) ids.add(id);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (url && key) {
    try {
      const db = createClient(url, key, { auth: { persistSession: false } });
      const { data } = await db.from("admin_users").select("telegram_user_id");
      for (const row of data ?? []) {
        const id = String(row?.telegram_user_id ?? "").trim();
        if (id) ids.add(id);
      }
    } catch {
      // Table unreachable: the env-configured recipients still get it,
      // which is the behaviour this function had before.
    }
  }
  return [...ids];
}

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
    const chatIds = await adminChatIds();

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

    // One recipient failing must never silence the others: an admin who
    // has never pressed Start on the bot answers 403 ("bot can't
    // initiate conversation with a user"), and that is their setup
    // problem, not a reason the owner misses the payment.
    const method = screenshot_url ? "sendPhoto" : "sendMessage";
    const results = await Promise.all(
      chatIds.map(async (chatId) => {
        try {
          const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              screenshot_url
                ? { chat_id: chatId, photo: screenshot_url, caption, reply_markup: replyMarkup }
                : { chat_id: chatId, text: caption, reply_markup: replyMarkup },
            ),
          });
          const data = await res.json();
          return { chatId, ok: !!data.ok, error: data.description ?? null };
        } catch (err) {
          return { chatId, ok: false, error: String(err) };
        }
      }),
    );

    const delivered = results.filter((r) => r.ok).length;
    if (delivered === 0) {
      return new Response(
        JSON.stringify({ error: "no_recipient_reached", results }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true, delivered, results }), {
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
