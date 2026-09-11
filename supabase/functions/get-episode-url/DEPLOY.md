# Closing the VIP gap — deploy order

The order matters. Done out of sequence, playback breaks for paying
viewers; done in this order, there is never a moment when it is down.

## Before you start

`get-episode-url` needs these secrets (the first three already exist for
the other functions):

    TELEGRAM_BOT_TOKEN
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY

Optional: `VIDEO_BUCKET` (default `videos`), `SIGNED_URL_TTL_SECONDS`
(default 6 hours).

## Step 1 — deploy the function and the app

    supabase functions deploy get-episode-url

The app change is already safe to ship on its own. While the bucket is
still public the function verifies the viewer, refuses the ones who have
not paid, and hands the allowed ones the stored URL because signing a
public object does nothing. Playback is unchanged for everyone who
should have it.

**Verify before going further.** Open an episode as a paying member —
it must play. Then open a members-only episode as a non-member: it must
now refuse. If it still plays, stop here; the rest will not help.

## Step 2 — stop shipping video_url to the browser

In `src/lib/api.ts`, `fetchEpisodesByShow` still does `select('*')`,
which includes `video_url` for every episode. Replace the `*` with the
column list the app actually reads. Nothing outside Admin uses
`video_url` any more except the fallback in `lib/playback.ts`, which
step 3 makes unnecessary.

Do this only after step 1 is verified: until the function is live, that
fallback is the only thing playing anything.

## Step 3 — make the bucket private

Supabase dashboard → Storage → `videos` → make private.

This is the step that actually closes the hole. A URL that leaked while
the bucket was public stops working the moment it flips, and from then
on every link the app hands out expires on its own.

**Check immediately after:** play one episode. It should still work, and
the URL in the network tab should now carry a `token=` query parameter.
If playback fails, flip the bucket back to public — that restores the
previous behaviour instantly — and check the function logs.

## What this does not fix

Episodes whose `video_url` points at a host that is not Supabase storage
(an external CDN) cannot be signed. Access is still checked, and the URL
no longer ships with the episode list, but nothing here can expire a
link on a server we do not control. Those files have to move into the
bucket to be covered.

A determined member can still record their own screen. Nothing in any
streaming app prevents that; the watch-session log in VideoPlayerScreen
is what narrows down who, after the fact.
