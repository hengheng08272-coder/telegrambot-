-- Real ABA PayWay Payment Gateway integration (Create Transaction +
-- Check Transaction APIs) — replaces the static "merchant payment link"
-- approach with a proper per-payment transaction that ABA itself
-- confirms server-to-server, instead of relying on a forwarded
-- Telegram notification + amount-matching guess (see
-- aba-payment-webhook, which stays as a secondary fallback and is not
-- removed by this migration).
--
-- tran_id: the transaction ID we generate and send to ABA when calling
-- the Create Transaction (Purchase) API. Stored so the callback (and
-- Check Transaction API polling) can map ABA's response back to the
-- right row.
--
-- payment_method: how this particular submission was paid — 'gateway'
-- (real ABA PayWay API, this migration) vs 'manual' (old screenshot /
-- QR-scan flow) — shown in Admin Panel so admins know which rows were
-- already server-verified and which still need a human look.
--
-- Safe to run multiple times.

ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS aba_tran_id text;
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS payment_submissions_aba_tran_id_idx
  ON payment_submissions (aba_tran_id) WHERE aba_tran_id IS NOT NULL;
