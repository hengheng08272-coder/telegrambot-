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
//   TELEGRAM_MINIAPP_URL   - optional. The Mini App link from BotFather,
//                            e.g. https://t.me/YourBotName/app (no query
//                            string). Anything that is not a t.me link is
//                            ignored and the link is built from getMe.

// The "watch now" button must be a Telegram deep link
// (https://t.me/<bot>/<app>?startapp=...), not the site's own https URL.
// TELEGRAM_MINIAPP_URL had been set to the Vercel address, so Telegram
// treated the button as an ordinary web link: tapping it raised "Do you
// want to open ...?" and threw the viewer into a browser, outside the
// Mini App, with no Telegram identity and therefore no VIP.
//
// Rather than depend on that secret being right, the bot's own username
// is read from getMe when it isn't — the bot token is already here, so
// this needs no new configuration. TELEGRAM_MINIAPP_SHORT_NAME overrides
// the "app" path segment if the Mini App is published under another one.
async function miniAppBase(botToken: string): Promise<string> {
  const configured = (Deno.env.get("TELEGRAM_MINIAPP_URL") ?? "").trim().replace(/\/+$/, "");
  if (/^https:\/\/t\.me\//i.test(configured)) return configured;

  const me = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
    .then((r) => r.json())
    .catch(() => null);
  const username = me?.ok ? me.result?.username : null;
  if (!username) {
    console.warn(
      "[MINIAPP] Could not resolve the bot username; falling back to " +
        `TELEGRAM_MINIAPP_URL (${configured || "unset"}), which opens in a browser.`,
    );
    return configured;
  }

  const shortName =
    (Deno.env.get("TELEGRAM_MINIAPP_SHORT_NAME") ?? "app").trim().replace(/^\/+|\/+$/g, "");
  return `https://t.me/${username}${shortName ? `/${shortName}` : ""}`;
}

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
    const miniAppUrl = await miniAppBase(botToken);

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
