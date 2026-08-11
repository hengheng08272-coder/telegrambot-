/*
# VIP subscriptions + payment review (addition)

Reintroduces paid VIP access, gated by Telegram identity (no viewer
sign-in — the same telegram_user_id used everywhere else in this app,
from getCurrentTelegramUser()). Two tables:

- subscriptions      — one row per Telegram account, current VIP status
- payment_submissions — every screenshot a viewer uploads as proof of
                        payment, reviewed by the admin (Telegram bot
                        Approve/Reject buttons AND the Admin Panel)

Run this once in the SQL Editor.
*/

CREATE TABLE IF NOT EXISTS subscriptions (
  telegram_user_id text PRIMARY KEY,
  telegram_username text,
  tier text,
  expires_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Public read (the app checks "am I subscribed" with no login) + public
-- insert/update so the client can create the first row. There's no
-- money movement in this table itself — moving expires_at forward only
-- happens after a payment_submissions row is approved by an admin (see
-- policies below), so a viewer editing their own row here can't grant
-- themselves free VIP.
CREATE POLICY "public_read_subscriptions" ON subscriptions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin_write_subscriptions" ON subscriptions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));
-- The service-role key (used by edge functions, e.g. when the bot
-- Approve button fires) bypasses RLS entirely, so approvals still work
-- without a viewer ever needing write access here.

CREATE TABLE IF NOT EXISTS payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL,
  telegram_username text,
  tier text NOT NULL,
  amount numeric NOT NULL,
  screenshot_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  submitted_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  admin_note text
);

ALTER TABLE payment_submissions ENABLE ROW LEVEL SECURITY;

-- Anyone can submit (no login) and read the list (needed so a viewer can
-- see their own submission's status — usernames are already visible to
-- everyone in the Telegram group anyway). Only an admin can update status.
CREATE POLICY "public_insert_payment_submissions" ON payment_submissions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "public_read_payment_submissions" ON payment_submissions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin_update_payment_submissions" ON payment_submissions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- Storage bucket for the payment screenshots themselves.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-proofs', 'payment-proofs', true, 10485760, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public_read_payment_proofs" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'payment-proofs');
CREATE POLICY "public_upload_payment_proofs" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'payment-proofs');

-- ---------- KHQR images, admin-editable (no code change needed) ----------
-- One row per pricing tier ('1m','2m','3m','6m','12m'). The admin uploads/
-- replaces the QR image for each tier from the Admin Panel -> QR Codes
-- panel; SubscriptionModal reads image_url from here instead of a static
-- file, so the client can update these themselves whenever their bank
-- QR changes — no developer, no code deploy.
CREATE TABLE IF NOT EXISTS payment_qr_codes (
  tier text PRIMARY KEY,
  image_url text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payment_qr_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_qr_codes" ON payment_qr_codes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin_write_qr_codes" ON payment_qr_codes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('payment-qr-codes', 'payment-qr-codes', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public_read_qr_bucket" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'payment-qr-codes');
CREATE POLICY "admin_write_qr_bucket" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'payment-qr-codes' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (bucket_id = 'payment-qr-codes' AND EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

