-- Stores the KHQR payload decoded from each tier's QR image at the moment
-- the admin uploads it (see SubscriptionsPanel -> decodeKhqrFromFile).
--
-- WHY: the payment screen builds ABA's one-tap deeplink
--   abamobilebank://ababank.com?type=payway&qrcode=<KHQR>
-- from this payload. It used to re-download the stored PNG and decode it
-- in the viewer's browser, which is slower and quietly fails if the
-- storage host does not return CORS headers (the canvas taints and the
-- "Open ABA" button silently never appears). Decoding once at upload
-- time removes that whole failure class.
--
-- Safe to re-run.

alter table payment_qr_codes add column if not exists khqr_string text;

comment on column payment_qr_codes.khqr_string is
  'KHQR payload decoded from image_url at upload time; used to build the one-tap ABA deeplink.';
