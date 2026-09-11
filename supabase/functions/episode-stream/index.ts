import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Hands out an episode's video URL only to someone actually entitled to
// it. Until this existed, `episodes.video_url` was world-readable (RLS
// policy "public_read_episodes ... USING (true)") and the VIP check lived
// entirely in the browser — so anyone with the anon key, which ships in
// the app bundle by definition, could read every URL in the catalog and
// play it without ever paying.
//
// Two things are checked here, both server-side:
//
//   1. WHO is asking — Telegram's initData, verified by HMAC against the
//      bot token. The app previously trusted `initDataUnsafe`, which the
//      client can put anything into.
//   2. WHETHER they may watch it — free show / free preview episode for
//      anyone, a bought movie for its buyer, everything else only while
//      `subscriptions.expires_at` is still in the future.
//
// Required secrets: TELEGRAM_BOT_TOKEN
// Optional: VIDEO_BUCKET (default "videos"), SIGNED_URL_TTL_SECONDS
//
// -- Added later --------------------------------------------------------
// This function was deployed and then never called: the player kept
// reading episode.video_url straight out of its props, so the gate sat
// in front of a door nobody used. The app now calls it for every play.
//
// It also now signs. Returning the stored URL was enough to decide WHO
// may watch, but not to stop what happens next: the `videos` bucket is
// public, so a URL handed to one paying member kept working for everyone
// they forwarded it to, forever. Where the file lives in our own bucket
// the answer is a short-lived signed link instead. Signing a public
// object is a no-op, so this is safe to run before the bucket is flipped
// private — it simply starts mattering the moment it is.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
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
 * token. Returns the Telegram user id, or null when anything fails.
 */
async function verifyInitData(initData: string, botToken: string): Promise<string | null> {
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
    return user?.id ? String(user.id) : null;
  } catch {
    return null;
  }
}

/**
 * Turn whatever an admin pasted into `video_url` into a storage object
 * path, when it is one of ours. Three shapes exist in the data: a full
 * public URL, a bare object path, and a URL on somebody else's host.
 * Only the first two can be signed; the third is returned untouched.
 */
function toStoragePath(videoUrl: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = videoUrl.indexOf(marker);
  if (at !== -1) return decodeURIComponent(videoUrl.slice(at + marker.length));
  if (!/^https?:\/\//i.test(videoUrl)) return videoUrl.replace(/^\/+/, "");
  return null;
}

/**
 * The last step for an allowed viewer. Falls back to the stored URL when
 * the file is not ours to sign, or when signing fails — which is what
 * keeps playback working while the bucket is still public.
 */
async function grant(
  admin: ReturnType<typeof createClient>,
  videoUrl: string,
  reason: string,
): Promise<Response> {
  const bucket = Deno.env.get("VIDEO_BUCKET") ?? "videos";
  const ttl = Number(Deno.env.get("SIGNED_URL_TTL_SECONDS") ?? 6 * 60 * 60);
  const path = toStoragePath(videoUrl, bucket);
  if (!path) return json({ url: videoUrl, reason, signed: false });

  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) return json({ url: videoUrl, reason, signed: false });
  return json({ url: data.signedUrl, reason, signed: true, expiresIn: ttl });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { episode_id, init_data } = await req.json().catch(() => ({}));
    if (!episode_id) return json({ error: "missing episode_id" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: episode } = await admin
      .from("episodes")
      .select("id, show_id, video_url, is_free_preview")
      .eq("id", episode_id)
      .maybeSingle();

    if (!episode) return json({ error: "not_found" }, 404);
    if (!episode.video_url) return json({ error: "no_video" }, 404);

    const { data: show } = await admin
      .from("shows")
      .select("id, type, is_free")
      .eq("id", episode.show_id)
      .maybeSingle();

    // Free content needs no identity at all — the browser preview and a
    // viewer who opened the app outside Telegram both land here.
    if (show?.is_free || episode.is_free_preview) {
      return await grant(admin, episode.video_url, "free");
    }

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "server_not_configured" }, 500);

    const telegramUserId = init_data ? await verifyInitData(init_data, botToken) : null;
    if (!telegramUserId) return json({ error: "not_verified" }, 401);

    // A standalone movie is bought per title; VIP deliberately does not
    // cover it (same rule as the client's handlePlayEpisode).
    if (show?.type === "movie") {
      const { data: purchase } = await admin
        .from("movie_purchases")
        .select("id")
        .eq("telegram_user_id", telegramUserId)
        .eq("show_id", episode.show_id)
        .eq("status", "approved")
        .maybeSingle();
      if (!purchase) return json({ error: "not_purchased" }, 403);
      return await grant(admin, episode.video_url, "purchased");
    }

    const { data: sub } = await admin
      .from("subscriptions")
      .select("expires_at")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();

    if (!sub?.expires_at || new Date(sub.expires_at) <= new Date()) {
      return json({ error: "not_subscribed" }, 403);
    }

    return await grant(admin, episode.video_url, "subscribed");
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
