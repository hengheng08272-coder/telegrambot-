/*
# ABA PayWay generate-qr (addition)

aba-create-transaction asks PayWay to issue the KHQR for one ticket and
gets back a payload plus an ABA Mobile deeplink. Both are stored on the
ticket, for two reasons.

The first is correctness. A ticket that asked twice would hold two
tran_ids, and aba-payment-callback finds a ticket by tran_id — so the
first QR would stay payable while matching nothing. Someone pays it and
the money arrives with no ticket to credit. Keeping the issued QR means
the second ask returns the first answer instead of opening a rival
transaction.

The second is that a viewer who backgrounds the app and comes back
should see the same QR, not a fresh one that invalidates the code
already open in their banking app.

  aba_qr_string  - the KHQR payload PayWay issued (its `qrString`)
  aba_deeplink   - `abapay_deeplink`, which opens ABA Mobile straight
                   onto the confirm screen

Both belong to a single payment attempt and are worthless afterwards;
neither is a secret (the payload is what the QR shows anyone who scans
it), so they need no special handling beyond the existing RLS.

The unique index is a guard on the lookup the callback depends on: two
tickets sharing a tran_id would make its .maybeSingle() ambiguous, and
Postgres refusing the second write is a better outcome than a payment
credited to whichever row came back first.

Run after database/aba-gateway-addition.sql. Safe to re-run.
*/

ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS aba_qr_string text;
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS aba_deeplink text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_submissions_aba_tran_id_idx
  ON payment_submissions (aba_tran_id) WHERE aba_tran_id IS NOT NULL;

COMMENT ON COLUMN payment_submissions.aba_qr_string IS
  'KHQR payload issued by ABA PayWay generate-qr for this ticket.';
COMMENT ON COLUMN payment_submissions.aba_deeplink IS
  'abapay_deeplink from the same response; opens ABA Mobile on the confirm screen.';
