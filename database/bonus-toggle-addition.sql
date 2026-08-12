/*
# Bonus spin on/off toggle (addition)

Lets the admin turn the purchase-tied bonus spin on/off per tier from
Admin Panel -> Subscriptions, right next to the price/description
fields — no code change needed. When off for a tier, a new purchase of
that tier does not unlock a bonus spin (existing unclaimed ones for that
tier stop being offered too).

Run this once, after pricing-tiers-addition.sql.
*/

ALTER TABLE pricing_tiers ADD COLUMN IF NOT EXISTS bonus_enabled boolean NOT NULL DEFAULT true;
