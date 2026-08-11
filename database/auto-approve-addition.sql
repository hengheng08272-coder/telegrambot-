/*
# Auto-approve after 30s, admin confirms after the fact (addition)

If the admin doesn't Approve/Reject within 30 seconds of a payment
screenshot being submitted, the viewer's own app auto-approves itself
(client calls the new auto-approve-payment edge function) so they aren't
stuck waiting — VIP access + their bonus spin unlock immediately.

The submission is NOT considered fully handled just because it was
auto-approved: it stays flagged for the admin to look at afterward
(Admin Panel -> Payments -> "Needs confirmation" section) and either
Confirm (leave it) or Revoke (fraud — ends their VIP immediately).

Run this once, after subscription-payment-addition.sql.
*/

ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS auto_approved boolean NOT NULL DEFAULT false;
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS admin_confirmed boolean NOT NULL DEFAULT false;
