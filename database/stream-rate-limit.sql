-- ---------- how much of the library one account may be handed ----------
--
-- Deciding WHO may watch (episode-stream's subscription and purchase
-- checks) says nothing about HOW MUCH. A paid account can be a viewer or
-- a mirror of the catalog, and the difference is not in the entitlement —
-- it is in the rate. This is the only place that can see that rate,
-- because it is the only place a playable URL is minted.
--
-- THE UNIT IS THE EPISODE, NEVER THE REQUEST.
-- Watching the same episode ten times — paused, reloaded, resumed
-- tomorrow, or watched again because it is a favourite — costs one slot,
-- not ten, and an episode already inside the window is served no matter
-- how full that window is. Taking the library is many different files;
-- loving one show is the same file again. Only the first is rationed.
--
-- The cap lives in app_settings so it can be raised without a deploy:
--   app_settings.stream_limit_per_hour   (default 30, 0 or less = off)

CREATE TABLE IF NOT EXISTS stream_grants (
  telegram_user_id text NOT NULL,
  episode_id uuid NOT NULL,
  first_granted_at timestamptz NOT NULL DEFAULT now(),
  last_granted_at timestamptz NOT NULL DEFAULT now(),
  grant_count int NOT NULL DEFAULT 1,
  PRIMARY KEY (telegram_user_id, episode_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_grants_window
  ON stream_grants(telegram_user_id, last_granted_at DESC);

ALTER TABLE stream_grants ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policy on purpose: only episode-stream, running
-- as the service role, touches this. A viewer reading their own quota
-- would gain nothing and hand a script the map of its own limit.
CREATE POLICY "admin_read_stream_grants" ON stream_grants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

INSERT INTO app_settings (key, value, updated_at)
VALUES ('stream_limit_per_hour', '30', now())
ON CONFLICT (key) DO NOTHING;

-- Returns the decision rather than raising, so episode-stream can answer
-- the viewer politely instead of failing.
CREATE OR REPLACE FUNCTION claim_stream_grant(
  p_telegram_user_id text,
  p_episode_id uuid,
  p_limit int DEFAULT NULL
)
RETURNS TABLE(allowed boolean, used int, cap int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cap  int;
  v_used int;
  v_seen boolean;
BEGIN
  IF p_telegram_user_id IS NULL OR p_episode_id IS NULL THEN
    RETURN QUERY SELECT true, 0, 0;
    RETURN;
  END IF;

  v_cap := p_limit;
  IF v_cap IS NULL THEN
    SELECT nullif(a.value, '')::int INTO v_cap FROM app_settings a WHERE a.key = 'stream_limit_per_hour';
  END IF;
  v_cap := coalesce(v_cap, 30);

  IF v_cap <= 0 THEN  -- limiter switched off
    INSERT INTO stream_grants (telegram_user_id, episode_id)
    VALUES (p_telegram_user_id, p_episode_id)
    ON CONFLICT (telegram_user_id, episode_id) DO UPDATE
      SET last_granted_at = now(), grant_count = stream_grants.grant_count + 1;
    RETURN QUERY SELECT true, 0, v_cap;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM stream_grants g
    WHERE g.telegram_user_id = p_telegram_user_id
      AND g.episode_id = p_episode_id
      AND g.last_granted_at > now() - interval '1 hour'
  ) INTO v_seen;

  SELECT count(*) INTO v_used
  FROM stream_grants g
  WHERE g.telegram_user_id = p_telegram_user_id
    AND g.last_granted_at > now() - interval '1 hour';

  -- A re-watch is always free. Deliberately checked BEFORE the cap.
  IF v_seen THEN
    UPDATE stream_grants
       SET last_granted_at = now(), grant_count = grant_count + 1
     WHERE telegram_user_id = p_telegram_user_id AND episode_id = p_episode_id;
    RETURN QUERY SELECT true, v_used, v_cap;
    RETURN;
  END IF;

  IF v_used >= v_cap THEN
    RETURN QUERY SELECT false, v_used, v_cap;
    RETURN;
  END IF;

  INSERT INTO stream_grants (telegram_user_id, episode_id)
  VALUES (p_telegram_user_id, p_episode_id)
  ON CONFLICT (telegram_user_id, episode_id) DO UPDATE
    SET last_granted_at = now(), grant_count = stream_grants.grant_count + 1;

  RETURN QUERY SELECT true, v_used + 1, v_cap;
END;
$$;

-- episode-stream is the only caller, and it runs as the service role.
REVOKE EXECUTE ON FUNCTION claim_stream_grant(text, uuid, int) FROM public;
GRANT EXECUTE ON FUNCTION claim_stream_grant(text, uuid, int) TO service_role;
