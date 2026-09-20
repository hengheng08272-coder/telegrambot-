// =====================================================================
// telegram-admin-session
// ---------------------------------------------------------------------
// Turns a Telegram Mini App session into a real Supabase admin session,
// so an administrator never types a password.
//
// WHY THIS IS A SERVER FUNCTION. The app's own getIdentity() reads the
// Telegram user in the browser and passes the id to the database as an
// ordinary parameter, and the anon key ships inside the JS bundle. That
// is fine for "which tickets are mine" -- the worst case is someone
// reading their own data -- but it is nowhere near enough to hand out
// administrator rights: anyone could send the owner's id, which is
// public, and take over the platform.
//
// So privilege is granted only from initData that Telegram itself
// signed, verified here against the bot token, which the browser never
// sees. Same check episode-stream uses.
//
// Required secrets: TELEGRAM_BOT_TOKEN, SUPABASE_URL,
//                   SUPABASE_SERVICE_ROLE_KEY
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// initData older than this is refused, so a signed string copied out of
// someone else's session stops working the same day.
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Telegram's documented Mini App check: every field except `hash`, sorted
 * by key as "key=value" lines, HMAC'd with a secret derived from the bot
 * token. Returns the verified user, or null when anything fails.
 */
async function verifyInitData(
  initData: string,
  botToken: string,
): Promise<{ id: string; username: string | null; name: string } | null> {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    const authDate = Number(params.get("auth_date") ?? 0);
    if (!authDate || Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SECONDS) return null;

    const dataCheckString = [...params.entries()]
      .filter(([key]) => key !== "hash")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
    const expected = toHex(await hmacSha256(secretKey, dataCheckString));
    if (expected !== hash) return null;

    const user = JSON.parse(params.get("user") ?? "null");
    if (!user?.id) return null;
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    return {
      id: String(user.id),
      username: user.username ? `@${user.username}` : null,
      name: name || user.username || `Telegram ${user.id}`,
    };
  } catch {
    return null;
  }
}

// One deterministic auth account per Telegram id. The gmail.com domain
// is the same workaround src/lib/auth.ts documents: Supabase Auth
// rejects addresses whose domain has no MX records, no mail is ever
// sent, and these users are scoped to this project so they can never
// collide with a real Gmail account.
const emailFor = (telegramId: string) => `tg${telegramId}@gmail.com`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!botToken || !url || !serviceKey) return json({ error: "not_configured" }, 500);

  let initData = "";
  try {
    initData = String((await req.json())?.initData ?? "");
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!initData) return json({ error: "bad_request" }, 400);

  const who = await verifyInitData(initData, botToken);
  // Unsigned, tampered with, or stale. Nothing below runs on a guess.
  if (!who) return json({ error: "unverified" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: row } = await admin
    .from("admin_users")
    .select("role, label")
    .eq("telegram_user_id", who.id)
    .maybeSingle();

  const email = emailFor(who.id);

  // Find the paired auth account, if this Telegram id has ever had one.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users?.find((u) => u.email === email) ?? null;

  if (!row) {
    // Not an administrator. If they used to be, revoke now rather than
    // waiting for someone to remember: removing the admin_users row is
    // the whole revocation gesture, and it has to bite on next open.
    if (existing) {
      await admin
        .from("profiles")
        .update({ is_admin: false, admin_role: null })
        .eq("id", existing.id);
    }
    return json({ error: "not_admin" }, 403);
  }

  let userId = existing?.id ?? null;
  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { telegram_user_id: who.id, telegram_username: who.username },
    });
    if (createErr || !created?.user) return json({ error: "provision_failed" }, 500);
    userId = created.user.id;
  }

  // display_name is NOT NULL, so it always carries something.
  const { error: profileErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      display_name: row.label || who.username || who.name,
      is_admin: true,
      admin_role: row.role,
    },
    { onConflict: "id" },
  );
  if (profileErr) return json({ error: "profile_failed" }, 500);

  // A one-shot token the client exchanges for a session with
  // supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }). No
  // password exists for these accounts, so there is none to leak.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return json({ error: "link_failed" }, 500);

  return json({ ok: true, token_hash: tokenHash, role: row.role });
});
