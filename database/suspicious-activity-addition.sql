-- ---------- mass-download / leak detection ----------
--
-- WHAT THIS MEASURES, AND WHY THE FIRST TWO ATTEMPTS DID NOT WORK
--
-- v1 counted watch_log ROWS: "5 in 5 minutes". v2 counted DISTINCT
-- episodes behind those rows. Both were wrong for the same reason, and
-- the production data said so plainly: across seven days the MEDIAN gap
-- between one viewer's episode opens was 0.0 seconds, and 90-96% of all
-- opens came less than five seconds apart — for a customer who had just
-- paid for a plan, and for the owner's own account, not only for whoever
-- might be ripping.
--
-- Opening an episode is a NAVIGATION event. Someone whose video will not
-- load taps Next, Next, Next, and every tap writes a row. Counting those
-- rows measures frustration, and 151 flags had accumulated doing exactly
-- that.
--
-- v3 counts what cannot be produced by tapping: episodes the viewer
-- STAYED on. The client writes each row unqualified and marks it a dwell
-- period later (WATCH_DWELL_MS in VideoPlayerScreen, via
-- mark_watch_qualified). Tapping through twenty episodes qualifies none
-- of them; working through twenty at machine speed qualifies all twenty.
-- watch_log still records every open, because that is the forensic record
-- of who had which episode on screen — it simply is not the detector.
--
--   FAST_QUALIFIED = 12 episodes stayed on, within 10 minutes
--   SLOW_QUALIFIED = 40 episodes stayed on, within 60 minutes
--   BAN_AT_STRIKE  = 3
--
-- WHAT HAPPENS THEN — warn, warn, ban.
--   Strike 1  the viewer sees a message explaining what looked wrong and
--             what to do instead (WatchWarningModal). The admin is not
--             notified: most first flags are a buffering problem, and
--             waking the owner for those is how an alert becomes noise.
--   Strike 2  a sterner message, and the admin is told.
--   Strike 3  blocked (blocked_telegram_users, the same row a human admin
--             would write), logged to ban_log, and the admin is told.
--   Strikes expire after 7 days, and only strikes raised by the CURRENT
--   rule version count — otherwise the ladder would land its third blow
--   using evidence gathered by a rule this project no longer trusts.

CREATE TABLE IF NOT EXISTS suspicious_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL,
  telegram_username text,
  episode_count int NOT NULL,
  window_minutes int NOT NULL,
  distinct_episodes int,
  level text NOT NULL DEFAULT 'warning',   -- 'warning' | 'ban'
  strike int NOT NULL DEFAULT 1,
  reason text,                             -- 'fast_burst' | 'sustained'
  rule_version int NOT NULL DEFAULT 3,
  acknowledged_at timestamptz,             -- set when the viewer dismisses it
  detected_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suspicious_activity_detected ON suspicious_activity(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_suspicious_activity_user ON suspicious_activity(telegram_user_id, detected_at DESC);

ALTER TABLE suspicious_activity ENABLE ROW LEVEL SECURITY;

-- Same access shape as ban_log: only the trigger function (SECURITY
-- DEFINER, runs as the table owner) writes rows; only an admin reads them.
-- A viewer never selects from this table — the two functions at the
-- bottom are the whole window they get, and each is scoped to one id.
CREATE POLICY "admin_read_suspicious_activity" ON suspicious_activity FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- The dwell flag that makes all of this work.
ALTER TABLE watch_log ADD COLUMN IF NOT EXISTS qualified boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_watch_log_qualified
  ON watch_log(telegram_user_id, started_at DESC) WHERE qualified;

CREATE OR REPLACE FUNCTION mark_watch_qualified(p_watch_id uuid, p_telegram_user_id text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE watch_log
     SET qualified = true
   WHERE id = p_watch_id
     AND telegram_user_id = p_telegram_user_id
     AND started_at > now() - interval '30 minutes';
$$;
GRANT EXECUTE ON FUNCTION mark_watch_qualified(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION flag_watch_burst()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  FAST_QUALIFIED constant int := 12;
  FAST_MINUTES   constant int := 10;
  SLOW_QUALIFIED constant int := 40;
  SLOW_MINUTES   constant int := 60;
  BAN_AT_STRIKE  constant int := 3;
  RULE_VERSION   constant int := 3;

  fast_count    int;
  slow_count    int;
  hit_window    int;
  hit_count     int;
  recent_flag   boolean;
  prior_strikes int;
  next_strike   int;
  next_level    text;
  why           text;
BEGIN
  IF NEW.telegram_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only rows the viewer stayed on. An unqualified row — the tap-through
  -- — is deliberately invisible here.
  SELECT count(DISTINCT (show_id, episode_label)) INTO fast_count
  FROM watch_log
  WHERE telegram_user_id = NEW.telegram_user_id
    AND qualified
    AND started_at > now() - (FAST_MINUTES || ' minutes')::interval;

  SELECT count(DISTINCT (show_id, episode_label)) INTO slow_count
  FROM watch_log
  WHERE telegram_user_id = NEW.telegram_user_id
    AND qualified
    AND started_at > now() - (SLOW_MINUTES || ' minutes')::interval;

  IF fast_count >= FAST_QUALIFIED THEN
    hit_count := fast_count; hit_window := FAST_MINUTES; why := 'fast_burst';
  ELSIF slow_count >= SLOW_QUALIFIED THEN
    hit_count := slow_count; hit_window := SLOW_MINUTES; why := 'sustained';
  ELSE
    RETURN NEW;
  END IF;

  -- One sitting is one strike, so a single run cannot climb from first
  -- warning to ban inside the same minute.
  SELECT EXISTS (
    SELECT 1 FROM suspicious_activity
    WHERE telegram_user_id = NEW.telegram_user_id
      AND detected_at > now() - interval '1 hour'
  ) INTO recent_flag;

  IF recent_flag THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO prior_strikes
  FROM suspicious_activity
  WHERE telegram_user_id = NEW.telegram_user_id
    AND rule_version = RULE_VERSION
    AND detected_at > now() - interval '7 days';

  next_strike := prior_strikes + 1;
  next_level := CASE WHEN next_strike >= BAN_AT_STRIKE THEN 'ban' ELSE 'warning' END;

  INSERT INTO suspicious_activity (
    telegram_user_id, telegram_username, episode_count, window_minutes,
    distinct_episodes, level, strike, reason, rule_version
  )
  VALUES (
    NEW.telegram_user_id, NEW.telegram_username, hit_count, hit_window,
    hit_count, next_level, next_strike, why, RULE_VERSION
  );

  IF next_level = 'ban' THEN
    IF NOT EXISTS (
      SELECT 1 FROM blocked_telegram_users WHERE telegram_user_id = NEW.telegram_user_id
    ) THEN
      INSERT INTO blocked_telegram_users (telegram_user_id, telegram_username, reason, blocked_by)
      VALUES (
        NEW.telegram_user_id, NEW.telegram_username,
        'ស្វ័យប្រវត្តិ: សង្ស័យ mass-download (' || hit_count || ' វគ្គ/' || hit_window || ' នាទី, ដងទី ' || next_strike || ')',
        'auto'
      );
      INSERT INTO ban_log (telegram_user_id, telegram_username, action, reason, source, performed_by)
      VALUES (
        NEW.telegram_user_id, NEW.telegram_username, 'ban',
        'mass-download suspected: ' || hit_count || ' qualified episodes in ' || hit_window || ' min (strike ' || next_strike || ')',
        'auto', 'system'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_watch_burst ON watch_log;
CREATE TRIGGER trg_flag_watch_burst
  AFTER INSERT ON watch_log FOR EACH ROW EXECUTE FUNCTION flag_watch_burst();

-- The evidence appears when a row QUALIFIES, not when it is written, so
-- the check runs then too. Firing only on INSERT always counts one open
-- behind, and a run that stops the moment it has what it came for would
-- never have its last episodes counted at all. The once-an-hour guard
-- inside the function stops the two paths raising the same flag twice.
DROP TRIGGER IF EXISTS trg_flag_watch_qualified ON watch_log;
CREATE TRIGGER trg_flag_watch_qualified
  AFTER UPDATE OF qualified ON watch_log FOR EACH ROW
  WHEN (NEW.qualified AND NOT OLD.qualified)
  EXECUTE FUNCTION flag_watch_burst();

-- ---------- what the viewer is told ----------
CREATE OR REPLACE FUNCTION get_my_watch_warning(p_telegram_user_id text)
RETURNS TABLE(id uuid, level text, strike int, distinct_episodes int, window_minutes int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.level, s.strike, s.distinct_episodes, s.window_minutes
  FROM suspicious_activity s
  WHERE s.telegram_user_id = p_telegram_user_id
    AND s.acknowledged_at IS NULL
    AND s.detected_at > now() - interval '24 hours'
  ORDER BY s.detected_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION ack_watch_warning(p_telegram_user_id text, p_id uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE suspicious_activity
     SET acknowledged_at = now()
   WHERE id = p_id AND telegram_user_id = p_telegram_user_id;
$$;

GRANT EXECUTE ON FUNCTION get_my_watch_warning(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION ack_watch_warning(text, uuid) TO anon, authenticated;

-- ---------- Supabase Dashboard setup (one-time, after running this file) ----------
-- Database -> Webhooks -> Create a new webhook:
--   Table: suspicious_activity   Events: Insert
--   Type: Supabase Edge Function -> notify-suspicious-activity
-- That function decides whether the admin actually hears about it: first
-- strikes are the viewer's warning to read, not the owner's to act on.
