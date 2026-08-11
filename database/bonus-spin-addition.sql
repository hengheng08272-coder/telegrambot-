/*
# Purchase-tied bonus spin (addition)

Lets a VIP purchase itself unlock a bonus lucky-draw spin, with a reward
pool sized to what they bought (marketing incentive — the more they buy,
the better the bonus-day range). This is IN ADDITION to the existing
one-time free spin every viewer already gets.

Run this once, after subscription-payment-addition.sql.
*/

-- payment_submissions needs a flag so a given approved purchase only
-- ever unlocks its bonus spin once.
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS bonus_spin_claimed boolean NOT NULL DEFAULT false;

-- spin_claims previously allowed exactly one row per Telegram account
-- (UNIQUE on telegram_user_id alone). That has to loosen to allow a
-- second (third, fourth...) row per person — one per distinct source
-- (the free spin, or a specific purchase's bonus spin) — while still
-- blocking the same source being claimed twice.
ALTER TABLE spin_claims ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'free';
ALTER TABLE spin_claims DROP CONSTRAINT IF EXISTS spin_claims_telegram_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS spin_claims_one_per_source
  ON spin_claims(telegram_user_id, source);
