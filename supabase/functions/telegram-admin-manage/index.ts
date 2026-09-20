// =====================================================================
// telegram-admin-manage
// ---------------------------------------------------------------------
// Lets the owner add and remove administrators from inside the app,
// instead of somebody running SQL against admin_users by hand.
//
// WHY THIS IS A SERVER FUNCTION, AGAIN. admin_users has row level
// security on with no policies at all, so the browser cannot read it or
// write to it under any key that ships in the bundle -- deliberately,
// because "admin = this Telegram id" checked anywhere the client can
// reach would hand the platform to whoever read the JS. The service
// role bypasses RLS, and it only lives here.
//
// So every call re-proves who is asking the same way
// telegram-admin-session does: Telegram's own signature over initData,
// verified against the bot token. The caller's Supabase session is NOT
// the proof -- a plain admin has a perfectly real session, and must
// still not be able to promote himself. The role is re-read from
// admin_users on every single call, so demoting somebody takes effect
// on their very next tap rather than whenever their session expires.
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

async function verifyInitData(
  initData: string,
  botToken: string,
): Promise<{ id: string; username: string | null } | null> {
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
    return { id: String(user.id), username: user.username ? `@${user.username}` : null };
  } catch {
    return null;
  }
}

// Same deterministic pairing telegram-admin-session provisions with, so
// a removal can find and blank the profile that session created.
const emailFor = (telegramId: string) => `tg${telegramId}@gmail.com`;

/** Strips a pasted "@name", a t.me link, or stray spaces down to digits. */
const cleanId = (raw: unknown) => String(raw ?? "").replace(/[^0-9]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!botToken || !url || !serviceKey) return json({ error: "not_configured" }, 500);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const initData = String(body.initData ?? "");
  if (!initData) return json({ error: "bad_request" }, 400);

  const who = await verifyInitData(initData, botToken);
  if (!who) return json({ error: "unverified" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // The caller's own level, read fresh. Only the owner may change who
  // else has keys; a plain admin gets the same 403 an outsider does.
  const { data: me } = await admin
    .from("admin_users")
    .select("role")
    .eq("telegram_user_id", who.id)
    .maybeSingle();
  if (me?.role !== "super_admin") return json({ error: "forbidden" }, 403);

  const action = String(body.action ?? "list");

  const listAll = async () => {
    const { data, error } = await admin
      .from("admin_users")
      .select("telegram_user_id, role, label, added_at, added_by")
      .order("added_at", { ascending: true });
    if (error) return json({ error: "read_failed" }, 500);
    return json({ ok: true, me: who.id, admins: data ?? [] });
  };

  if (action === "list") return listAll();

  if (action === "add") {
    const targetId = cleanId(body.telegram_user_id);
    // A Telegram id is a number. A @username is not one, and cannot be
    // resolved to one from here -- the Bot API has no lookup by handle
    // -- so refusing is honest where guessing would silently create a
    // row that never matches anybody.
    if (!targetId) return json({ error: "need_numeric_id" }, 400);

    const role = String(body.role ?? "admin");
    if (role !== "admin" && role !== "super_admin") return json({ error: "bad_role" }, 400);

    const label = String(body.label ?? "").trim().slice(0, 64) || null;

    const { error } = await admin.from("admin_users").upsert(
      {
        telegram_user_id: targetId,
        role,
        label,
        added_by: who.username ?? who.id,
      },
      { onConflict: "telegram_user_id" },
    );
    if (error) return json({ error: "write_failed" }, 500);

    // An existing session of theirs keeps whatever level it was minted
    // at until they reopen the app, so a promotion is pushed onto the
    // profile now as well.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((u) => u.email === emailFor(targetId));
    if (existing) {
      await admin
        .from("profiles")
        .update({ is_admin: true, admin_role: role })
        .eq("id", existing.id);
    }

    return listAll();
  }

  if (action === "remove") {
    const targetId = cleanId(body.telegram_user_id);
    if (!targetId) return json({ error: "need_numeric_id" }, 400);

    // Removing yourself would leave the platform with nobody who can
    // add anybody -- there is no other door into admin_users -- and the
    // only way back would be a hand-written SQL statement from a
    // computer, which the owner does not have. So it is refused.
    if (targetId === who.id) return json({ error: "cannot_remove_self" }, 400);

    const { data: target } = await admin
      .from("admin_users")
      .select("role")
      .eq("telegram_user_id", targetId)
      .maybeSingle();
    if (!target) return listAll(); // Already gone; nothing to undo.

    // Same lockout, one step removed: the last owner must survive even
    // when a second owner is the one being deleted.
    if (target.role === "super_admin") {
      const { count } = await admin
        .from("admin_users")
        .select("telegram_user_id", { count: "exact", head: true })
        .eq("role", "super_admin");
      if ((count ?? 0) <= 1) return json({ error: "last_super_admin" }, 400);
    }

    const { error } = await admin
      .from("admin_users")
      .delete()
      .eq("telegram_user_id", targetId);
    if (error) return json({ error: "write_failed" }, 500);

    // telegram-admin-session already revokes on their next open, but
    // "next open" can be tomorrow, and somebody being removed is
    // exactly the person who might not reopen politely. Blanking the
    // profile here closes the panel on them immediately.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list?.users?.find((u) => u.email === emailFor(targetId));
    if (existing) {
      await admin
        .from("profiles")
        .update({ is_admin: false, admin_role: null })
        .eq("id", existing.id);
    }

    return listAll();
  }

  return json({ error: "unknown_action" }, 400);
});
