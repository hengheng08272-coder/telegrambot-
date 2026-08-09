import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Triggered by a Supabase Database Webhook on INSERT into `episodes`.
// Looks up the show, then posts a message into the VIP Telegram group
// with a button that deep-links straight into the Mini App on that show
// (see App.tsx's getStartParam handling for `show_<id>`).
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_BOT_TOKEN     - from @BotFather
//   TELEGRAM_GROUP_ID      - the VIP group's chat id (negative number,
//                            e.g. -1001234567890)
//   TELEGRAM_MINIAPP_URL   - e.g. https://t.me/YourBotName/app
//                            (the Mini App link from BotFather, no query string)

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
    // Database Webhooks send { type, table, record, old_record }
    const episode = payload.record;
    if (!episode?.show_id) {
      return new Response(JSON.stringify({ error: "no episode record" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const groupId = Deno.env.get("TELEGRAM_GROUP_ID")!;
    const miniAppUrl = Deno.env.get("TELEGRAM_MINIAPP_URL")!;

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: show } = await admin
      .from("shows")
      .select("title")
      .eq("id", episode.show_id)
      .maybeSingle();

    const showTitle = show?.title ?? "Show";
    const epLabel = episode.episode_number ? `EP ${episode.episode_number}` : "New episode";
    const deepLink = `${miniAppUrl}?startapp=show_${episode.show_id}`;

    const text = `🎬 *${showTitle}*\n${epLabel} — ${episode.title ?? "New episode"} ត្រូវបានដាក់បញ្ចូលរួចហើយ!`;

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: groupId,
        text,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "មើលឥឡូវនេះ 📺", url: deepLink }]],
        },
      }),
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
