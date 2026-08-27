/*
# Telegram Auto-Post — addition

Powers an automatic Telegram bot post into the VIP group: every
`interval_minutes`, the bot posts `shows_per_run` shows (poster + title +
synopsis + current episode + a "watch now" link into the Mini App),
rotating through the catalog so the same title isn't repeated until every
other show has had a turn.

Run this after telegram-miniapp-schema.sql.
*/

-- Singleton settings row (id is always 1) — edited from the Admin Panel's
-- "Telegram Auto-Post" panel, read by the telegram-auto-post edge function.
CREATE TABLE IF NOT EXISTS telegram_auto_post_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  interval_minutes integer NOT NULL DEFAULT 180 CHECK (interval_minutes >= 5),
  shows_per_run integer NOT NULL DEFAULT 1 CHECK (shows_per_run >= 1 AND shows_per_run <= 10),
  last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO telegram_auto_post_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE telegram_auto_post_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_telegram_auto_post_settings" ON telegram_auto_post_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
CREATE POLICY "admin_write_telegram_auto_post_settings" ON telegram_auto_post_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- One row per show ever auto-posted, so the picker can favour whichever
-- shows haven't been posted in the longest time (or never at all) instead
-- of repeating the same handful.
CREATE TABLE IF NOT EXISTS telegram_auto_post_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_auto_post_log_show_id_posted_at_idx
  ON telegram_auto_post_log (show_id, posted_at DESC);

ALTER TABLE telegram_auto_post_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_telegram_auto_post_log" ON telegram_auto_post_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

COMMENT ON TABLE telegram_auto_post_settings IS
  'Singleton config for the telegram-auto-post edge function: on/off, how often (minutes), and how many shows per run.';
COMMENT ON TABLE telegram_auto_post_log IS
  'History of shows the auto-poster has sent into the group, used to rotate through the catalog instead of repeating.';
