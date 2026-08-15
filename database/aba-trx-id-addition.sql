-- Store the bank's OWN transaction reference from the ABA notification
-- text, so an auto-confirmed payment can never be granted twice and so
-- the admin has a real reference to check against a bank statement.
--
-- Real ABA notification this was built against:
--   $2.00 paid by ROM SARY (*297) on Aug 14, 04:54 PM via ABA PAY
--   at PANG SOK HENG S2_Nint.Ani. Trx. ID: 178670124828004, APV: 993238.
--
-- aba_trx_id  - the "Trx. ID" value (178670124828004). Unique per real
--               payment, which is what makes the index below a genuine
--               replay guard: if the notification-forwarder retries, or
--               both the Telegram webhook and the HTTPS ingest see the
--               same alert, the second write is refused by Postgres
--               rather than granting a second month of VIP.
-- aba_payer   - who paid, as printed ("ROM SARY (*297)"). Display only —
--               never matched on, since it changes every payment and has
--               no link to a Telegram account.
--
-- NOTE this is deliberately a DIFFERENT column from `aba_tran_id`
-- (aba-gateway-addition.sql). That one is the id WE generate and send to
-- ABA PayWay's API; this one is the id ABA prints in its own alert. A
-- payment can legitimately have either, or both.
--
-- Safe to run multiple times.

ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS aba_trx_id text;
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS aba_payer text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_submissions_aba_trx_id_idx
  ON payment_submissions (aba_trx_id) WHERE aba_trx_id IS NOT NULL;
