import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// How many people are actually in the Telegram group.
//
// The owner's question was "I have 600 viewers but only 200 in the
// group -- where did the rest go?", and answering it needs both numbers
// side by side. The app already knows its own audience (bot_users,
// admin_audience_stats); only Telegram knows the group's size, and
// asking Telegram means using the bot token, which must never reach a
// browser. Hence a server-side function rather than a direct call.
//
// (The premise turned out to be wrong -- "600" was a count of episode
// plays, and the real unique-viewer total is close to the group size --
// which is exactly why the two numbers now sit next to each other.)
//
// Required secrets, both already set for the other functions:
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_GROUP_ID

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // supabase-js attaches apikey and x-client-info to every
  // functions.invoke() call; omitting them here fails the CORS preflight
  // and the real POST never leaves the browser. verify-membership was
  // silently broken this exact way for a while.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Admin-only, checked twice over: the platform's verify_jwt proves
    // the caller holds a valid session, and this proves the session
    // belongs to an admin. A signed-in non-admin must not be able to
    // read the group's size.
    const authHeader = req.headers.get("Authorization") ?? "";
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await caller.auth.getUser();
    if (!user) return json({ error: "not signed in" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.is_admin) return json({ error: "not an admin" }, 403);

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const groupId = Deno.env.get("TELEGRAM_GROUP_ID")!;

    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getChatMemberCount?chat_id=${encodeURIComponent(groupId)}`,
    );
    const data = await res.json();

    if (!data.ok) {
      console.error("getChatMemberCount failed:", JSON.stringify(data));
      // 200 with an error field, not a 5xx: the Admin panel renders this
      // as one dash in one tile. A failing side-stat must not look to
      // the caller like the whole request broke.
      return json({ member_count: null, error: data.description ?? "telegram error" });
    }

    return json({ member_count: data.result as number });
  } catch (err) {
    return json({ member_count: null, error: String(err) });
  }
});
