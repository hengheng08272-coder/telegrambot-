-- ---------- watch log (who watched what, and when) ----------
-- Written silently by the client every time an episode starts playing —
-- no visible watermark on the video itself, just a record in Supabase
-- that the admin can check later. If content leaks, this log narrows
-- down who was watching that episode around that time.
CREATE TABLE IF NOT EXISTS watch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text,
  telegram_username text,
  show_id uuid REFERENCES shows(id) ON DELETE SET NULL,
  show_title text NOT NULL,
  episode_label text NOT NULL,
  started_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_log_started ON watch_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_log_user ON watch_log(telegram_user_id);

ALTER TABLE watch_log ENABLE ROW LEVEL SECURITY;

-- Anyone can log their own watch session (same pattern as spin_claims) —
-- but only an admin can read the log back.
CREATE POLICY "public_insert_watch_log" ON watch_log FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "admin_read_watch_log" ON watch_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
