-- ===========================================================================
-- Auto-expire stale payment tickets
-- ---------------------------------------------------------------------------
-- Run this once in Supabase -> SQL Editor (safe to re-run).
--
-- WHY THIS EXISTS
-- The VIP payment screen opens a payment_submissions row ("ticket") the
-- moment the viewer taps "ចូលសមាជិត VIP", then listens for 3 minutes for
-- the ABA auto-confirm webhook to match a real bank notification against
-- it. If those 3 minutes pass with (a) no ABA match and (b) no receipt
-- photo attached, the app closes that ticket and opens a fresh one.
--
-- Viewers are anonymous (anon role) and deliberately cannot UPDATE
-- payment_submissions — otherwise anyone could approve their own payment.
-- So the close runs through this SECURITY DEFINER function instead, which
-- is intentionally narrow: it can only ever set status to 'rejected',
-- never 'approved', and only for a row that is still pending, has no
-- screenshot attached, and is genuinely older than the listening window.
-- Nothing here can grant VIP time.
--
-- The 150-second floor (rather than 180) tolerates client clock skew so a
-- phone running slightly fast can't close a ticket early.
-- ===========================================================================

-- The original schema declared screenshot_url NOT NULL, back when a
-- receipt photo was mandatory. The current flow opens the ticket first
-- and treats the photo as an optional shortcut, so a ticket has to be
-- allowed to exist without one. Without this, every "ចូលសមាជិត VIP" tap
-- fails at the INSERT.
ALTER TABLE payment_submissions ALTER COLUMN screenshot_url DROP NOT NULL;

-- Marks a ticket that was closed by the 3-minute timer rather than by a
-- human. The Telegram Approve button treats these as still-approvable,
-- so an admin who checks their bank a few minutes late can still grant
-- VIP instead of hitting a dead "Already rejected" ticket.
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS auto_expired boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION expire_stale_payment_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE payment_submissions
     SET status = 'rejected',
         auto_expired = true,
         reviewed_at = now()
   WHERE id = p_submission_id
     AND status = 'pending'
     AND screenshot_url IS NULL
     AND submitted_at < now() - interval '150 seconds';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION expire_stale_payment_submission(uuid) FROM public;
GRANT EXECUTE ON FUNCTION expire_stale_payment_submission(uuid) TO anon, authenticated;
