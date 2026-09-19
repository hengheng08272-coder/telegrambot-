import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Triggered by a Supabase Database Webhook on INSERT into
// `suspicious_activity` (see database/suspicious-activity-addition.sql for
// the trigger that decides when a row lands there).
//
// It no longer forwards everything. The detector now escalates — warn,
// warn, ban — and the first strike is a conversation with the viewer, not
// an incident for the owner: most first flags are somebody whose video
// would not load. Waking the admin for those is how a useful alert turns
// into one more notification nobody reads. Strike two and the ban both
// come through, because by then it is a pattern.
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

  const json = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const payload = await req.json();
    const row = payload.record;
    if (!row?.telegram_user_id) {
      return json(400, { error: "no suspicious_activity record" });
    }

    const level = String(row.level ?? "warning");
    const strike = Number(row.strike ?? 1);

    // Strike one is the viewer's warning to read, not the owner's problem
    // to solve. Answering 200 rather than an error: nothing went wrong,
    // there is simply nothing to send.
    if (level !== "ban" && strike < 2) {
      return json(200, { ok: true, skipped: "first_strike" });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID")!;

    const who = row.telegram_username ? `@${row.telegram_username}` : row.telegram_user_id;
    const count = row.distinct_episodes ?? row.episode_count;
    const banned = level === "ban";

    const text = banned
      ? `⛔ បានផ្អាកស្វ័យប្រវត្តិ — សង្ស័យ mass-download\n` +
        `👤 ${who}\n` +
        `🆔 ${row.telegram_user_id}\n` +
        `📺 ${count} វគ្គ (មើលពិត) ក្នុង ${row.window_minutes} នាទី · ដងទី ${strike}\n\n` +
        `អ្នកប្រើនេះត្រូវបានបិទរួចហើយ។ បើសង្ស័យខុស សូមដោះចេញក្នុង Admin → Blocked Users។`
      : `⚠️ ព្រមានលើកទី ${strike} — សង្ស័យ mass-download\n` +
        `👤 ${who}\n` +
        `🆔 ${row.telegram_user_id}\n` +
        `📺 ${count} វគ្គ (មើលពិត) ក្នុង ${row.window_minutes} នាទី\n\n` +
        `អ្នកប្រើបានឃើញសារព្រមានហើយ។ លើកក្រោយនឹងបិទដោយស្វ័យប្រវត្តិ។\n` +
        `/ban ${row.telegram_user_id} mass-download — បិទភ្លាមឥឡូវ`;

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: adminChatId, text }),
    });

    const tgData = await tgRes.json();
    if (!tgData.ok) return json(502, { error: tgData.description });

    return json(200, { ok: true, level, strike });
  } catch (err) {
    return json(500, { error: String(err) });
  }
});
