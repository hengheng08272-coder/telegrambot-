/*
# Editable pricing tiers (addition)

Lets the admin edit each plan's price and description directly from the
Admin Panel -> Subscriptions panel — no code change needed. The app's
hardcoded PRICING_TIERS (lib/subscription.ts) stays as the fallback/
seed values; a row here for a given tier key overrides its price,
labels, and pitch text.

Run this once, after subscription-payment-addition.sql.
*/

CREATE TABLE IF NOT EXISTS pricing_tiers (
  key text PRIMARY KEY,
  price numeric NOT NULL,
  label_km text NOT NULL,
  label_en text NOT NULL,
  pitch_km text,
  bonus_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE pricing_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_pricing_tiers" ON pricing_tiers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin_write_pricing_tiers" ON pricing_tiers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true));

-- Seed with the current live values, so the panel starts pre-filled
-- instead of blank.
INSERT INTO pricing_tiers (key, price, label_km, label_en, pitch_km) VALUES
  ('1m', 3, '១ ខែ', '1 Month', 'ចាប់ផ្តើមមើលភ្លាមៗ — មួយខែពេញ'),
  ('2m', 5, '១ ខែ (Bonus ធំ)', '1 Month (Big Bonus)', 'ដូចគ្នា ១ខែ ប៉ុន្តែរង្វាន់ធំជាងច្រើន!'),
  ('6m', 16, '៦ ខែ', '6 Months', 'សន្សំសំចៃជាង — សម្រាប់អ្នកមើលទៀងទាត់'),
  ('12m', 27, '១២ ខែ', '12 Months', 'តម្លៃល្អបំផុត — សន្សំសំចៃច្រើនបំផុត')
ON CONFLICT (key) DO NOTHING;
