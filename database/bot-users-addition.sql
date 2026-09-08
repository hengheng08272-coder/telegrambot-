-- ---------- bot_users (who has actually started the bot) ----------
--
-- Until now nothing recorded this. `/start` in telegram-admin-bot sent a
-- welcome message and forgot the person immediately, so the one number
-- the owner kept asking for -- "how many followers do I have?" -- could
-- not be answered at all, and there was no list to broadcast an invite
-- to. The Admin panel's "Watched today" was standing in for it, but that
-- counts rows in watch_log (episode plays), so one viewer watching
-- twenty episodes read as twenty people.
--
-- Two rules make this count mean something:
--
--   * Keyed on the USER (message.from.id), never the chat. `/start`
--     typed inside a group arrives with chat.id = the group, so keying
--     on the chat would file the whole group as one "follower".
--   * Private chats only. Telegram lets a bot message a person only
--     after they have opened a private chat with it, so a private
--     /start is exactly the population a broadcast can reach. A /start
--     shouted in a group grants no such permission and must not inflate
--     the number.
CREATE TABLE IF NOT EXISTS bot_users (
  telegram_user_id text PRIMARY KEY,
  telegram_username text,
  first_name text,
  -- First and most recent /start. The bot's upsert sends only
  -- `last_seen_at`, and PostgREST's ON CONFLICT sets just the columns it
  -- was given, so `started_at` keeps its original DEFAULT now() value --
  -- the true join date, even after the person types /start again months
  -- later.
  --
  -- There is deliberately no `start_count`: incrementing a counter
  -- through PostgREST needs an RPC, and an RPC on this table would be
  -- callable by anon -- i.e. a way for anyone to invent followers. The
  -- number of times someone re-typed /start is not worth that.
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_users_started ON bot_users(started_at DESC);

ALTER TABLE bot_users ENABLE ROW LEVEL SECURITY;

-- No public policy at all: the only writer is telegram-admin-bot, which
-- uses the service-role key and bypasses RLS. Unlike watch_log there is
-- no "insert your own row" case here -- a browser must never be able to
-- add followers -- so the anon role gets nothing.
CREATE POLICY "admin_read_bot_users" ON bot_users FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
