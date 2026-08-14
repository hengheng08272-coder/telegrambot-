-- Adds an optional ABA PayWay "Payment Link" per tier, alongside the
-- existing KHQR image. When set, the Subscribe modal shows a "Pay Now"
-- button that opens this link directly (ABA app / browser checkout) so
-- the viewer doesn't have to save the QR image and scan it separately.
--
-- IMPORTANT: exactly like the QR images, each tier needs its OWN link
-- generated for that tier's exact price via ABA Merchant -> Payment
-- Link (fixed amount). Do not reuse one tier's link for another tier.
--
-- Safe to run multiple times.

ALTER TABLE payment_qr_codes ADD COLUMN IF NOT EXISTS pay_link text;
