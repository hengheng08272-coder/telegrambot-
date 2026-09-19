# Closing the VIP gap — where this stands

## What was actually wrong

Three separate things, and only all three together explain why paying
made no difference:

1. **`episode-stream` existed but nothing called it.** It was deployed
   months ago and does the right checks. The player never used it — it
   read `episode.video_url` straight out of its React props — so the gate
   stood in front of a door nobody walked through.
2. **`episodes` is world-readable.** RLS policy `public_read_episodes`,
   `USING (true)`, granted to `anon`. Anyone with the anon key — which
   ships inside the app bundle by definition — can read every episode row
   including `video_url`.
3. **The `videos` bucket is public.** So a URL, once seen, plays for
   anyone forever, with no session at all.

## Done

- **`episode-stream` v4 deployed.** Same identity and entitlement checks
  as before, plus it now returns a short-lived *signed* URL when the file
  lives in our own bucket. Signing a public object changes nothing, so
  this was safe to deploy immediately and simply starts mattering when
  the bucket is flipped.
- **The app now calls it** for every play, instead of reading the URL out
  of its props.

That closes hole 1. A non-member is now refused by the server.

## Step 2 — verify before going further

Open a members-only episode with an account that has no subscription. It
must refuse. Then open one as a paying member: it must play.

If the non-member can still watch, stop — the rest will not help, and
something about the call is not reaching the function.

## Step 3 — stop shipping `video_url` to the browser

Two halves, in this order:

**a. Client.** In `src/lib/api.ts`, `fetchEpisodesByShow` still does
`select('*')`. Replace it with the explicit column list — everything on
`Episode` except `video_url`:

    id, show_id, episode_number, season, title, description,
    thumbnail_url, duration, is_free_preview, created_at

This is deliberately NOT done yet. `video_url` is currently the fallback
that keeps playback alive if the gate is ever unreachable, and removing
the net before step 2 is verified means a bad deploy takes playback down
with it.

**b. Database.** Once the deployed app no longer selects the column,
revoke it. RLS is row-level and cannot hide a column; Postgres column
privileges can:

    REVOKE SELECT (video_url) ON public.episodes FROM anon, authenticated;

The service role the edge function uses bypasses this, so the gate keeps
working. Do this only after (a) is live — any deployed client still
doing `select('*')` will start erroring with "permission denied for
column video_url" the moment it runs.

That closes hole 2.

## Step 4 — make the bucket private

Supabase dashboard → Storage → `videos` → make private.

This closes hole 3, and it is the one that makes leaked links die: a URL
copied while the bucket was public stops working immediately, and every
link handed out afterwards expires on its own.

**Check right after:** play one episode. It should work, and the URL in
the network tab should carry a `token=` parameter. If playback breaks,
flip the bucket back to public — that restores the old behaviour at once
— and read the function logs.

## What none of this fixes

Episodes whose `video_url` points at a host that is not Supabase storage
cannot be signed. Entitlement is still checked, but nothing here expires
a link on a server we do not control. Those files have to move into the
bucket to be covered.

Screen recording by a real member is not preventable by any app. The
watch-session log in VideoPlayerScreen is what narrows down who,
afterwards.
