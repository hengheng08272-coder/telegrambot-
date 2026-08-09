-- ---------- ban log (Telegram group ban/kick history) ----------
-- Telegram itself keeps no history of who was banned/kicked or why, so
-- this table is the actual record. Rows are written by the
-- `telegram-admin-bot` Edge Function only (via the service role key) —
-- never directly from the app, so viewers can never read or fake it.
CREATE TABLE IF NOT EXISTS ban_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL,
  telegram_username text,
  action text NOT NULL CHECK (action IN ('banned', 'unbanned', 'kicked_auto')),
  reason text,
  source text NOT NULL DEFAULT 'admin_command',
  performed_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ban_log_user ON ban_log(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_ban_log_created ON ban_log(created_at DESC);

ALTER TABLE ban_log ENABLE ROW LEVEL SECURITY;

-- Only the admin panel (a signed-in admin) can read it. Nobody can write
-- from the client at all — only the Edge Function's service-role key can,
-- which bypasses RLS entirely, so there is intentionally no INSERT policy.
CREATE POLICY "admin_read_ban_log" ON ban_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
