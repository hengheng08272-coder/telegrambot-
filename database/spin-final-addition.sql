/*
# Lucky Spin — final design (addition)

Run this if you already ran an earlier version of telegram-miniapp-schema.sql
(daily-free-spin, or free+paid-credits versions). It replaces spin_claims
with the final simple model: one free spin per Telegram account, ever,
small/moderate rewards only. Drops spin_credits — there's no paid-spin
system anymore.

If you're setting up a brand-new project, you don't need this file — it's
already included in telegram-miniapp-schema.sql.
*/

DROP TABLE IF EXISTS spin_credits CASCADE;
DROP TABLE IF EXISTS spin_claims CASCADE;

CREATE TABLE spin_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL UNIQUE,
  telegram_username text,
  reward_days int NOT NULL,
  reward_label text NOT NULL,
  created_at timestamptz DEFAULT now(),
  redeemed boolean NOT NULL DEFAULT false
);

ALTER TABLE spin_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_insert_spin_claims" ON spin_claims FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_read_spin_claims" ON spin_claims FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin_update_spin_claims" ON spin_claims FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
