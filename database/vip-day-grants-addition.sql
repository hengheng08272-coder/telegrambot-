/*
# Manual VIP day grants — audit log (addition)

Admin -> Users can move a subscriber's expires_at by hand in two very
different situations that used to look identical afterwards:

- "extend"  — the ordinary +7 / +30 / +90 / custom top-up, e.g. fixing a
              payment that came through outside the app
- "bonus"   — a gift: a giveaway prize, an apology for downtime, a
              loyalty thank-you

Both wrote the same silent UPDATE, so a month later there was no way to
answer "who gave this account 90 free days, and why". This table keeps
one row per manual grant, with the kind and an optional note.

It records grants only — the day arithmetic still happens on the
subscriptions row itself, so a missing row here never means missing
days. That is deliberate: the log is allowed to fail without costing a
subscriber time they were promised.

Run this once in the SQL Editor.
*/

CREATE TABLE IF NOT EXISTS vip_day_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL,
  telegram_username text,
  -- 'extend' = routine top-up, 'bonus' = discretionary gift.
  kind text NOT NULL DEFAULT 'extend',
  days integer NOT NULL,
  note text,
  -- expires_at before and after, so the log stays readable even if the
  -- subscription is later revoked or overwritten.
  expires_before timestamptz,
  expires_after timestamptz,
  -- Which admin did it (profiles.id). Nullable so a grant made by an
  -- edge function or the Telegram bot can be logged too.
  granted_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vip_day_grants_user_idx
  ON vip_day_grants(telegram_user_id, created_at DESC);

ALTER TABLE vip_day_grants ENABLE ROW LEVEL SECURITY;

-- Admin-only, read and write. Unlike most tables here this gets NO
-- public read policy: it is an internal record of who was given what,
-- and viewers have no reason to enumerate other people's gifts.
CREATE POLICY "admin_read_vip_day_grants" ON vip_day_grants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

CREATE POLICY "admin_insert_vip_day_grants" ON vip_day_grants FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

COMMENT ON TABLE vip_day_grants IS
  'Audit log of manual VIP day grants made from Admin Panel -> Users. kind=''bonus'' marks a discretionary gift as opposed to a routine ''extend''.';
