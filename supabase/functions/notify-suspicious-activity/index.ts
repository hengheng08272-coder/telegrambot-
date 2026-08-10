import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Triggered by a Supabase Database Webhook on INSERT into
// `suspicious_activity` (see database/suspicious-activity-addition.sql for
// the trigger that decides when a row lands there). Sends an immediate
// Telegram DM to the admin — this is the "know right away" half of burst
// detection; the SQL trigger is the "notice the pattern" half.
//
// Required secrets (same ones already used by the other functions):
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_ADMIN_CHAT_ID

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const row = payload.record;
    if (!row?.telegram_user_id) {
      return new Response(JSON.stringify({ error: "no suspicious_activity record" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID")!;

    const who = row.telegram_username ? `@${row.telegram_username}` : row.telegram_user_id;
    const text =
      `⚠️ សង្ស័យ mass-download/leak\n` +
      `👤 ${who}\n` +
      `🆔 ${row.telegram_user_id}\n` +
      `📺 មើល ${row.episode_count} វគ្គក្នុងចន្លោះ ${row.window_minutes} នាទី\n\n` +
      `/ban ${row.telegram_user_id} mass-download — ban ភ្លាមៗ`;

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: adminChatId, text }),
    });

    const tgData = await tgRes.json();
    if (!tgData.ok) {
      return new Response(JSON.stringify({ error: tgData.description }), {
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
