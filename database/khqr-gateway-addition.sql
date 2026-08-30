-- ---------- KHQR gateway auto-confirm ----------
--
-- Adds the three columns the auto-confirm paths write, and the unique
-- indexes that make a paid QR spendable exactly once.
--
-- Two of these (khqr_md5, bakong_hash) are already referenced by the
-- bakong-verify function but were never created, so that function fails
-- on its first write with "column does not exist" -- which is part of
-- why nothing was auto-confirming.
--
-- Safe to re-run.

ALTER TABLE public.payment_submissions
  ADD COLUMN IF NOT EXISTS khqr_md5 text,
  ADD COLUMN IF NOT EXISTS khqr_bill_number text,
  ADD COLUMN IF NOT EXISTS bakong_hash text;

COMMENT ON COLUMN public.payment_submissions.khqr_md5 IS
  'md5 of the KHQR payload shown for this ticket; the key both the NBC API and the gateway answer "is it paid?" about.';
COMMENT ON COLUMN public.payment_submissions.khqr_bill_number IS
  'Bill number issued by the KHQR gateway (e.g. API-FCE31BB7). One bill belongs to one ticket.';
COMMENT ON COLUMN public.payment_submissions.bakong_hash IS
  'Transaction hash returned by the bank once the payment is confirmed.';

-- A bill or a bank transaction may be spent once. Whichever poll claims
-- it first grants the subscription; a second attempt is refused by
-- Postgres instead of handing out a second month. Partial, because the
-- overwhelming majority of rows have neither.
CREATE UNIQUE INDEX IF NOT EXISTS payment_submissions_khqr_bill_number_idx
  ON public.payment_submissions (khqr_bill_number)
  WHERE khqr_bill_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_submissions_bakong_hash_idx
  ON public.payment_submissions (bakong_hash)
  WHERE bakong_hash IS NOT NULL;

-- Looked up on every poll while a ticket is open.
CREATE INDEX IF NOT EXISTS payment_submissions_khqr_md5_idx
  ON public.payment_submissions (khqr_md5)
  WHERE khqr_md5 IS NOT NULL;
