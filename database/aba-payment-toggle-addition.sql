/*
# ABA payment on/off toggle (addition)

Kill switch for the "Pay with ABA Mobile" button on the payment-method
screen, for the times ABA's own KHQR rail is down rather than anything in
this app. Toggled from Admin Panel -> Subscriptions -> "QR & Deep link" --
no code change needed.

When off: the ABA button is shown disabled with a notice, and viewers are
pointed at "Other banks (KHQR)" instead (same QR, scannable by any KHQR
bank app). No new table -- this reuses the existing app_settings
key/value table (see app-settings-addition.sql), so this file only seeds
the default row.

Run this once, after app-settings-addition.sql. Safe to skip entirely:
the app treats a missing row the same as 'true' (ABA enabled).
*/

insert into public.app_settings (key, value)
values ('aba_payment_enabled', 'true')
on conflict (key) do nothing;
