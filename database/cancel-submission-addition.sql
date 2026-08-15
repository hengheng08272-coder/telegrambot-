-- ===========================================================================
-- Let a viewer cancel their own pending payment ticket on demand
-- ---------------------------------------------------------------------------
-- Run this once in Supabase -> SQL Editor (safe to re-run).
--
-- WHY THIS EXISTS
-- expire_stale_payment_submission (see auto-expire-submission-addition.sql)
-- only closes a ticket once it's genuinely stale (150s+ old) — that's the
-- background timeout path. This is the separate, on-demand path: the
-- viewer taps "ប្ដូរគម្រាង" (Change Plan) on the pay screen because they
-- want a different tier, and the ticket should close immediately instead
-- of waiting out the timer.
--
-- Same SECURITY DEFINER shape as the expire function and the same reason:
-- viewers are anonymous and deliberately cannot UPDATE payment_submissions
-- directly, so this narrow function is the only door — it can only ever
-- set status to 'rejected' for a row that is still 'pending', never
-- 'approved', and it can't touch any other row.
--
-- Deliberately does NOT set auto_expired — that flag means "closed by the
-- timer, an admin can still approve it late." A user-initiated cancel is a
-- real no, not a maybe, so it stays a plain rejection.
-- ===========================================================================

CREATE OR REPLACE FUNCTION cancel_payment_submission(p_submission_id uuid)
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
         reviewed_at = now()
   WHERE id = p_submission_id
     AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION cancel_payment_submission(uuid) FROM public;
GRANT EXECUTE ON FUNCTION cancel_payment_submission(uuid) TO anon, authenticated;
