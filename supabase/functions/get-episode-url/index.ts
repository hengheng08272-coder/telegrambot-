import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// The playback gate.
//
// Until this existed the paywall was a curtain, not a lock. Three things
// were true at once:
//
//   1. fetchEpisodesByShow did `select('*')`, so every episode's
//      video_url was handed to any browser that opened a show page.
//   2. The `videos` bucket was public, so those URLs played for anyone,
//      forever, with no session at all.
//   3. The only check was a React branch in handlePlayEpisode, which is
//      a variable in a page the viewer controls.
//
// So the fix cannot live in the client. This function is the only thing
// that turns an episode id into something playable, and it will not do
// it without a Telegram signature it has verified itself.
//
// Required secrets:
//   TELEGRAM_BOT_TOKEN         — also the key initData is signed with
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Optional:
//   VIDEO_BUCKET               — defaults to "videos"
//   SIGNED_URL_TTL_SECONDS     — defaults to 6 hours

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Telegram's own initData check, per their WebApp docs.
 *
 * The client sends the raw initData string Telegram handed it. Every
 * field except `hash` goes into a newline-joined, alphabetically sorted
 * `key=value` block; that block is HMAC'd with a key which is itself the
 * HMAC of the bot token under the literal string "WebAppData". Only
 * Telegram and the bot owner can produce that signature, which is what
 * makes the user id inside it worth trusting.
 *
 * Returns the telegram user id, or null if anything about the payload
 * does not add up.
 */
async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400,
): Promise<string | null> {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const enc = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, enc.encode(botToken));

  const signingKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", signingKey, enc.encode(dataCheckString));
  const computed = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Length-safe comparison. A plain !== leaks timing, and while nobody is
  // realistically timing an edge function over the public internet, the
  // constant-time version costs nothing to write.
  if (computed.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;

  // A signature stays valid forever, so a stale initData lifted from
  // somebody's session would too. auth_date bounds that.
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "{}");
    return user?.id ? String(user.id) : null;
  } catch {
    return null;
  }
}

/**
 * Turn whatever is in episodes.video_url into a storage object path, if
 * it is one of ours. Admins have pasted three shapes over time: a full
 * public URL, a bare object path, and a URL on somebody else's host.
 * Only the first two can be signed.
 */
function toStoragePath(videoUrl: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = videoUrl.indexOf(marker);
  if (at !== -1) return decodeURIComponent(videoUrl.slice(at + marker.length));
  if (!/^https?:\/\//i.test(videoUrl)) return videoUrl.replace(/^\/+/, "");
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !serviceKey) {
      return json({ error: "server_not_configured" }, 500);
    }

    const { initData, episodeId } = await req.json();
    if (!episodeId) return json({ error: "episodeId required" }, 400);

    const telegramUserId = await verifyInitData(initData ?? "", botToken);
    if (!telegramUserId) return json({ error: "unauthenticated" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: episode } = await admin
      .from("episodes")
      .select("id, show_id, video_url, is_free_preview")
      .eq("id", episodeId)
      .maybeSingle();
    if (!episode) return json({ error: "not_found" }, 404);

    const { data: show } = await admin
      .from("shows")
      .select("id, type, is_free")
      .eq("id", episode.show_id)
      .maybeSingle();
    if (!show) return json({ error: "not_found" }, 404);

    // Same order the client's own gate uses, so the two can never
    // disagree about who may watch what — except this one is the one
    // that decides.
    let allowed = false;
    let reason = "subscription_required";

    if (show.is_free || episode.is_free_preview) {
      allowed = true;
    } else if (show.type === "movie") {
      const { data: purchase } = await admin
        .from("movie_purchases")
        .select("id")
        .eq("telegram_user_id", telegramUserId)
        .eq("show_id", show.id)
        .eq("status", "approved")
        .limit(1)
        .maybeSingle();
      allowed = !!purchase;
      reason = "purchase_required";
    } else {
      const { data: sub } = await admin
        .from("subscriptions")
        .select("expires_at")
        .eq("telegram_user_id", telegramUserId)
        .maybeSingle();
      allowed = !!sub?.expires_at && new Date(sub.expires_at) > new Date();
    }

    if (!allowed) return json({ error: reason }, 403);
    if (!episode.video_url) return json({ error: "no_video" }, 404);

    const bucket = Deno.env.get("VIDEO_BUCKET") ?? "videos";
    const ttl = Number(Deno.env.get("SIGNED_URL_TTL_SECONDS") ?? 6 * 60 * 60);
    const path = toStoragePath(episode.video_url, bucket);

    // Not in our bucket — an externally hosted file. Access has still
    // been checked, and the URL no longer ships with the episode list,
    // but nothing here can expire a link on a host we do not control.
    if (!path) return json({ url: episode.video_url, signed: false }, 200);

    const { data: signed, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, ttl);

    // The bucket may still be public at this point — the code is meant
    // to ship BEFORE the bucket is flipped, so that playback never has a
    // window where it is broken. Falling back to the stored URL keeps
    // that true; once the bucket is private, signing succeeds and the
    // fallback stops being reachable.
    if (error || !signed?.signedUrl) {
      return json({ url: episode.video_url, signed: false }, 200);
    }
    return json({ url: signed.signedUrl, signed: true, expiresIn: ttl }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
