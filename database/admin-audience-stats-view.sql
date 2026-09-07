-- ---------- admin_audience_stats (people, not plays) ----------
--
-- The Admin panel's overview tile said "Watched today" and was a
-- `count: 'exact'` over watch_log — i.e. episode PLAYS. One viewer
-- finishing twenty episodes counted as twenty. On the day this was
-- found the panel showed ~680 while the real number of humans was ~24,
-- and that gap is what sent the owner looking for hundreds of missing
-- group members who had never existed.
--
-- Plays and viewers are both worth knowing — plays say how hard the
-- catalogue is being used, viewers say how many people are there — but
-- only the second can be compared against the Telegram group's size.
--
-- A view rather than de-duplicating in the browser: PostgREST cannot
-- express count(DISTINCT ...), and fetching a day of rows to de-duplicate
-- client-side silently undercounts past the 1000-row default limit,
-- which this app already exceeds (736 plays in one day).
--
-- "Today" is Phnom Penh's day. The owner reads this in Cambodia; a UTC
-- boundary would roll the number over at 7am local and make every
-- morning look dead.
CREATE OR REPLACE VIEW admin_audience_stats
WITH (security_invoker = true) AS
SELECT
  (SELECT count(DISTINCT telegram_user_id) FROM watch_log
     WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Phnom_Penh') AT TIME ZONE 'Asia/Phnom_Penh')::int
    AS viewers_today,
  (SELECT count(*) FROM watch_log
     WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Phnom_Penh') AT TIME ZONE 'Asia/Phnom_Penh')::int
    AS plays_today,
  (SELECT count(DISTINCT telegram_user_id) FROM watch_log
     WHERE started_at >= now() - interval '7 days')::int
    AS viewers_7d,
  (SELECT count(DISTINCT telegram_user_id) FROM watch_log)::int
    AS viewers_all_time,
  (SELECT count(*) FROM bot_users)::int
    AS bot_users;

-- security_invoker = true means the caller's own RLS applies to
-- watch_log and bot_users, both admin-read-only — so a non-admin reading
-- this view gets zeros, never anyone's data. anon is revoked outright:
-- a signed-out browser has no reason to ask.
REVOKE ALL ON admin_audience_stats FROM anon;
GRANT SELECT ON admin_audience_stats TO authenticated;
