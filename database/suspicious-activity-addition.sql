-- ---------- mass-download / leak burst detection ----------
-- Real viewing takes minutes per episode; someone scripting through the
-- catalog to rip it shows up as many `watch_log` rows for the same person
-- seconds apart. This flags that pattern automatically — no need to
-- notice it by eye in the watch log.
--
-- Safe to re-run: every policy, index and function below is replaced.
--
-- TUNING (no code change needed — edit the app_settings rows seeded at
-- the bottom of this file, or from the Admin Panel once a control exists):
--   suspicious_burst_count   = 15  -- this many DIFFERENT episodes...
--   suspicious_burst_minutes = 10  -- ...within this many minutes flags
--
-- Why these numbers: the first version flagged 5 episode-starts in 5
-- minutes, which normal viewers hit just by hunting for the episode they
-- left off at — the admin bot filled up with false alarms. Counting
-- distinct episodes over a longer window, together with the client only
-- logging after 15 seconds of real playback (VideoPlayerScreen.tsx),
-- leaves the ripping pattern flagged and ordinary browsing alone.

CREATE TABLE IF NOT EXISTS suspicious_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL,
  telegram_username text,
  episode_count int NOT NULL,
  window_minutes int NOT NULL,
  detected_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suspicious_activity_detected ON suspicious_activity(detected_at DESC);

-- Two watch_log rows landing at the same moment used to race each other:
-- both read "not flagged yet" and both inserted, so the admin got the
-- same alert twice. One row per person per clock hour, enforced by the
-- database, makes that impossible. Older duplicates are cleared out first
-- so the unique index can be created on an existing install.
DELETE FROM suspicious_activity a
USING suspicious_activity b
WHERE a.telegram_user_id = b.telegram_user_id
  AND date_trunc('hour', a.detected_at AT TIME ZONE 'UTC')
    = date_trunc('hour', b.detected_at AT TIME ZONE 'UTC')
  -- (detected_at, id) rather than detected_at alone: two alerts written in
  -- the same statement carry the identical timestamp, and comparing only
  -- that would delete neither, leaving the unique index below unbuildable.
  AND (a.detected_at, a.id) > (b.detected_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS suspicious_activity_user_hour_idx
  ON suspicious_activity (telegram_user_id, (date_trunc('hour', detected_at AT TIME ZONE 'UTC')));

ALTER TABLE suspicious_activity ENABLE ROW LEVEL SECURITY;

-- Same access shape as ban_log: only the trigger function (SECURITY
-- DEFINER, runs as the table owner) writes rows; only an admin reads them.
DROP POLICY IF EXISTS "admin_read_suspicious_activity" ON suspicious_activity;
CREATE POLICY "admin_read_suspicious_activity" ON suspicious_activity FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE OR REPLACE FUNCTION flag_watch_burst()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  burst_count int;
  burst_minutes int;
  recent_count int;
BEGIN
  IF NEW.telegram_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admin-tunable, with the defaults above as the fallback when the
  -- app_settings row is missing or holds something that isn't a number.
  BEGIN
    SELECT value::int INTO burst_count FROM app_settings WHERE key = 'suspicious_burst_count';
  EXCEPTION WHEN others THEN
    burst_count := NULL;
  END;
  BEGIN
    SELECT value::int INTO burst_minutes FROM app_settings WHERE key = 'suspicious_burst_minutes';
  EXCEPTION WHEN others THEN
    burst_minutes := NULL;
  END;

  burst_count := GREATEST(COALESCE(burst_count, 15), 2);
  burst_minutes := GREATEST(COALESCE(burst_minutes, 10), 1);

  -- DISTINCT: re-opening the same episode (a reload, a quality switch, a
  -- dropped connection) is one episode watched, not several.
  SELECT count(DISTINCT (show_id, episode_label)) INTO recent_count
  FROM watch_log
  WHERE telegram_user_id = NEW.telegram_user_id
    AND started_at > now() - make_interval(mins => burst_minutes);

  IF recent_count < burst_count THEN
    RETURN NEW;
  END IF;

  -- One alert per person per hour: the ON CONFLICT is the real guarantee
  -- (see the unique index above), so a burst never DMs the admin twice.
  INSERT INTO suspicious_activity (telegram_user_id, telegram_username, episode_count, window_minutes)
  VALUES (NEW.telegram_user_id, NEW.telegram_username, recent_count, burst_minutes)
  ON CONFLICT (telegram_user_id, (date_trunc('hour', detected_at AT TIME ZONE 'UTC'))) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_watch_burst ON watch_log;
CREATE TRIGGER trg_flag_watch_burst
  AFTER INSERT ON watch_log FOR EACH ROW EXECUTE FUNCTION flag_watch_burst();

-- Tunables live in app_settings (see app-settings-addition.sql) so the
-- numbers can be changed with one UPDATE instead of a migration.
INSERT INTO app_settings (key, value) VALUES ('suspicious_burst_count', '15')
ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('suspicious_burst_minutes', '10')
ON CONFLICT (key) DO NOTHING;

-- To loosen or tighten later, e.g. "flag at 20 episodes in 15 minutes":
--   UPDATE app_settings SET value = '20' WHERE key = 'suspicious_burst_count';
--   UPDATE app_settings SET value = '15' WHERE key = 'suspicious_burst_minutes';

-- ---------- Supabase Dashboard setup (one-time, after running this file) ----------
-- Database -> Webhooks -> Create a new webhook:
--   Table: suspicious_activity   Events: Insert
--   Type: Supabase Edge Function -> notify-suspicious-activity
-- This fires the Edge Function (see supabase/functions/notify-suspicious-activity)
-- the instant a burst is flagged, which DMs TELEGRAM_ADMIN_CHAT_ID right away.
