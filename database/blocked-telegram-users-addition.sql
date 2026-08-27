/*
# Blocked Telegram Users — addition

Lets the admin block specific viewers by Telegram user ID or @username.
A blocked viewer sees a full-screen "content removed" error instead of
the app — nothing else changes for anyone else.

Matching happens client-side against the viewer's own Telegram identity
(from Telegram's initData, read on app boot), so this table needs to be
publicly readable the same way `shows` already is — there's no viewer
sign-in to gate the read behind. Only the admin can add/remove rows.
*/

CREATE TABLE IF NOT EXISTS blocked_telegram_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text,
  telegram_username text,
  reason text,
  blocked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blocked_telegram_users_needs_id_or_username
    CHECK (telegram_user_id IS NOT NULL OR telegram_username IS NOT NULL)
);

-- Usernames are matched case-insensitively and without a leading "@", so
-- normalize on the way in — the admin can type either "@Foo" or "foo".
CREATE OR REPLACE FUNCTION normalize_blocked_telegram_username()
RETURNS trigger AS $$
BEGIN
  IF NEW.telegram_username IS NOT NULL THEN
    NEW.telegram_username := lower(ltrim(NEW.telegram_username, '@'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalize_blocked_telegram_username ON blocked_telegram_users;
CREATE TRIGGER trg_normalize_blocked_telegram_username
  BEFORE INSERT OR UPDATE ON blocked_telegram_users
  FOR EACH ROW EXECUTE FUNCTION normalize_blocked_telegram_username();

CREATE INDEX IF NOT EXISTS idx_blocked_telegram_users_user_id ON blocked_telegram_users(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_blocked_telegram_users_username ON blocked_telegram_users(telegram_username);

ALTER TABLE blocked_telegram_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_blocked_telegram_users" ON blocked_telegram_users FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin_write_blocked_telegram_users" ON blocked_telegram_users FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

COMMENT ON TABLE blocked_telegram_users IS
  'Telegram IDs/usernames the admin has blocked from the Mini App. A match on app boot shows a full-screen copyright-removal error instead of the app.';
