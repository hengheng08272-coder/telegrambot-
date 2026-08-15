import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// This is the missing piece that made the Share button (and honestly,
// every other entry point) a real leak: up to now, nothing in this app
// ever checked that the person opening it is actually a member of the
// paid VIP group. Access relied entirely on the Mini App link only being
// handed out inside the group — anyone who received that link from
// anyone, by any means (including the in-app Share button), could open
// the app and watch everything for free.
//
// This calls Telegram's own getChatMember API — the source of truth for
// group membership — using the bot token, which must never be exposed to
// the client, hence this being a server-side function rather than a
// direct call from the app.
//
// Required secrets (same ones already used by the other functions):
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_GROUP_ID
//
// FIX (this deploy): Access-Control-Allow-Headers was missing "apikey"
// and "x-client-info" — headers the supabase-js client always attaches
// to functions.invoke() calls. The browser's CORS preflight was failing
// on every single call as a result, silently blocking the *real* POST
// from ever leaving the browser (only the OPTIONS preflight ever reached
// this function — confirmed via the Supabase edge function logs, which
// showed thousands of OPTIONS 200s and zero POSTs). The call caught the
// resulting network error and failed open (membership stayed 'ok'), so
// viewers weren't blocked from the app, but the real membership check
// never once actually ran.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Statuses that count as "still in the group". "left" and "kicked" do not.
const MEMBER_STATUSES = new Set(["creator", "administrator", "member", "restricted"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { telegram_user_id } = await req.json();
    if (!telegram_user_id) {
      return new Response(JSON.stringify({ error: "telegram_user_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const groupId = Deno.env.get("TELEGRAM_GROUP_ID")!;

    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${groupId}&user_id=${telegram_user_id}`
    );
    const data = await res.json();

    // Telegram returns ok:false (e.g. "user not found") when the person
    // has never interacted with the group/bot at all — that's a clean
    // "not a member", not an error worth surfacing.
    const status = data.ok ? data.result?.status : null;
    const isMember = !!status && MEMBER_STATUSES.has(status);

    return new Response(JSON.stringify({ isMember, status: status ?? "unknown" }), {
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
