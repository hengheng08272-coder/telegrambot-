/*
# Bakong auto-confirm (addition)

Every other auto-confirm path in this project works backwards: it reads a
notification ABOUT a payment (a Telegram message, an Android notification
forwarded over HTTPS) and tries to match that text to a waiting ticket.
Text matching is why those paths need a replay guard, a payer name they
must ignore, and a tight window to keep matches honest.

Now that the app generates its own KHQR (src/lib/bakong.ts), there is a
direct route. Every generated payload has an md5, and Bakong's Open API
answers one question about it exactly:

    "has THIS payload been paid?"    POST /v1/check_transaction_by_md5

That is a per-ticket question, so there is nothing to match and nothing
to guess: the ticket that generated the QR is the ticket that gets
approved.

Two columns:

  khqr_md5     - md5 of the payload generated for this ticket. Written by
                 the bakong-verify edge function (service role) the first
                 time the viewer's app reports it, and only while the
                 ticket is still pending. RLS does not let a viewer write
                 this column directly.

  bakong_hash  - the bank's OWN transaction id, returned once the payment
                 lands. Written server-side only. The unique index below
                 makes it a replay guard: if two polls answer at once, or
                 someone tries to claim one real payment for a second
                 ticket, the write is refused by Postgres rather than
                 granting a second month of VIP.

NOTE bakong_hash is a THIRD, different column from aba_trx_id
(aba-trx-id-addition.sql, the id ABA prints in its notification text) and
aba_tran_id (aba-gateway-addition.sql, the id we send to ABA PayWay). A
payment can legitimately carry any combination of the three, depending on
which path confirmed it.

Safe to run multiple times.
*/

ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS khqr_md5 text;
ALTER TABLE payment_submissions ADD COLUMN IF NOT EXISTS bakong_hash text;

-- The replay guard. Partial so the many rows with no hash don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS payment_submissions_bakong_hash_idx
  ON payment_submissions (bakong_hash) WHERE bakong_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_submissions_khqr_md5_idx
  ON payment_submissions (khqr_md5) WHERE khqr_md5 IS NOT NULL;

COMMENT ON COLUMN payment_submissions.khqr_md5 IS
  'md5 of the KHQR payload generated for this ticket; the handle Bakong''s check_transaction_by_md5 answers about.';
COMMENT ON COLUMN payment_submissions.bakong_hash IS
  'Bakong''s own transaction hash, written only after the bank confirms payment. Unique — replay guard.';
