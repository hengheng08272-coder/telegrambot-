/*
# Referral rewards (addition)

Now that opening the Mini App no longer requires joining a Telegram
group (see App.tsx), growth relies on people sharing the app link
itself instead of a group invite link. This adds a lightweight
referral program on top of that:

- A viewer shares their personal link: t.me/YourBot/app?startapp=ref_<their_telegram_id>
- Whoever opens it gets tagged as "referred by" that person (first
  touch only — see referrals.referred_telegram_id being UNIQUE, one
  referrer credited per new viewer, no re-attribution if they open
  a different friend's link later)
- The tag is only durable once that new viewer actually pays and an
  admin approves the payment — this reflects a real paying customer,
  not just an app open, so it can't be farmed by opening links with
  no intent to subscribe
- On that approval (see telegram-admin-bot/index.ts pay_approve
  branch), the referrer's own subscription is extended by
  app_settings.referral_reward_days — same mechanism the admin
  already uses to extend a subscriber's own expires_at

Run this once in the SQL Editor.
*/

CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_telegram_id text NOT NULL,
  referred_telegram_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  rewarded boolean NOT NULL DEFAULT false,
  reward_days integer,
  rewarded_at timestamptz,
  reward_submission_id uuid REFERENCES payment_submissions(id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals(referrer_telegram_id);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- A viewer can record "I was referred by X" the first time they open
-- the app via a ref_ link (public insert, same trust level as
-- payment_submissions — no viewer login exists in this app). Only the
-- service-role key (edge function, on payment approval) ever flips
-- `rewarded`, so a viewer inserting their own row can't grant
-- themselves or anyone else free days.
CREATE POLICY "public_insert_referrals" ON referrals FOR INSERT TO anon, authenticated WITH CHECK (true);

-- A viewer can read referral rows to show "N friends joined" on their
-- own Account screen.
CREATE POLICY "public_read_referrals" ON referrals FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "admin_update_referrals" ON referrals FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- How many bonus VIP days the referrer gets once their referred
-- friend's first payment is approved. Editable from Admin Panel (or
-- directly in the app_settings table) without a code change.
INSERT INTO public.app_settings (key, value)
VALUES ('referral_reward_days', '3')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE referrals IS
  'One row per referred viewer (referred_telegram_id is unique — first referrer wins). rewarded flips to true, with reward_days/rewarded_at/reward_submission_id filled in, the moment that viewer''s first payment_submissions row is approved by an admin.';
