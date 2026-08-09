-- ---------- mass-download / leak burst detection ----------
-- Real binge-watching still takes at least a few minutes per episode
-- before the next one starts; someone scripting through episodes to
-- rip/leak the whole catalog shows up as many `watch_log` rows for the
-- same person seconds apart. This flags that pattern automatically —
-- no need to notice it by eye in the watch log.
--
-- Tune the two numbers below to taste:
--   BURST_COUNT   = 5   -- this many episode-starts...
--   BURST_MINUTES = 5   -- ...within this many minutes triggers a flag

CREATE TABLE IF NOT EXISTS suspicious_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL,
  telegram_username text,
  episode_count int NOT NULL,
  window_minutes int NOT NULL,
  detected_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suspicious_activity_detected ON suspicious_activity(detected_at DESC);

ALTER TABLE suspicious_activity ENABLE ROW LEVEL SECURITY;

-- Same access shape as ban_log: only the trigger function (SECURITY
-- DEFINER, runs as the table owner) writes rows; only an admin reads them.
CREATE POLICY "admin_read_suspicious_activity" ON suspicious_activity FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE OR REPLACE FUNCTION flag_watch_burst()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  recent_count int;
  already_flagged boolean;
BEGIN
  IF NEW.telegram_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO recent_count
  FROM watch_log
  WHERE telegram_user_id = NEW.telegram_user_id
    AND started_at > now() - interval '5 minutes';

  IF recent_count < 5 THEN
    RETURN NEW;
  END IF;

  -- Don't re-flag the same person again for an hour once caught, so one
  -- binge session doesn't spam ten alerts in a row.
  SELECT EXISTS (
    SELECT 1 FROM suspicious_activity
    WHERE telegram_user_id = NEW.telegram_user_id
      AND detected_at > now() - interval '1 hour'
  ) INTO already_flagged;

  IF already_flagged THEN
    RETURN NEW;
  END IF;

  INSERT INTO suspicious_activity (telegram_user_id, telegram_username, episode_count, window_minutes)
  VALUES (NEW.telegram_user_id, NEW.telegram_username, recent_count, 5);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_watch_burst ON watch_log;
CREATE TRIGGER trg_flag_watch_burst
  AFTER INSERT ON watch_log FOR EACH ROW EXECUTE FUNCTION flag_watch_burst();

-- ---------- Supabase Dashboard setup (one-time, after running this file) ----------
-- Database -> Webhooks -> Create a new webhook:
--   Table: suspicious_activity   Events: Insert
--   Type: Supabase Edge Function -> notify-suspicious-activity
-- This fires the Edge Function (see supabase/functions/notify-suspicious-activity)
-- the instant a burst is flagged, which DMs TELEGRAM_ADMIN_CHAT_ID right away.
