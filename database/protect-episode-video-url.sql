-- ---------- close the "non-VIP can watch VIP episodes" hole ----------
--
-- `episodes` is world-readable on purpose: the catalog, episode numbers,
-- titles and thumbnails all have to render before anyone signs up. The
-- problem was that `video_url` rode along in that same policy, and the
-- VIP check lived only in the browser (App.handlePlayEpisode). The anon
-- key ships inside the app bundle, so anyone could ask PostgREST for
-- every video_url in the catalog and play them without paying — which is
-- what the watch log caught: six episodes of one series logged by a
-- non-VIP account inside a single second.
--
-- Row-level security cannot hide one column, but column privileges can:
-- PostgREST refuses a select that touches a column the role has no
-- SELECT on. Viewers are always the `anon` role (they never get a
-- Supabase Auth session — only the admin signs in), so revoking the
-- column from `anon` alone closes the hole while leaving the Admin
-- Panel's episode editor untouched.
--
-- ORDER MATTERS:
--   1. deploy the `episode-stream` edge function
--   2. deploy the app (the player asks that function for the URL)
--   3. run this file
-- Running this first would stop playback for everyone until step 1.
--
-- Safe to re-run.

DO $$
DECLARE
  readable_columns text;
BEGIN
  -- Built from the live table rather than a hardcoded list, so a column
  -- added later (another *-addition.sql file) stays readable instead of
  -- silently disappearing from the catalog.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO readable_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'episodes'
    AND column_name <> 'video_url';

  -- Table-wide grant first, so the column-level grant below is the only
  -- SELECT privilege anon has left.
  EXECUTE 'REVOKE SELECT ON public.episodes FROM anon';
  EXECUTE format('GRANT SELECT (%s) ON public.episodes TO anon', readable_columns);
END $$;

-- The admin (role `authenticated`, gated further by profiles.is_admin in
-- the existing RLS policies) still needs the URL to edit episodes, and
-- the edge functions use the service role, which column privileges do
-- not apply to. Neither is touched above.

-- Verify: this should list every column EXCEPT video_url.
--   SELECT column_name FROM information_schema.column_privileges
--   WHERE table_name = 'episodes' AND grantee = 'anon' AND privilege_type = 'SELECT'
--   ORDER BY column_name;
