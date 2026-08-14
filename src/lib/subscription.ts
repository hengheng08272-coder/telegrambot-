import { supabase } from '@/lib/supabase/supabaseClient';
import { getCurrentTelegramUser } from '@/lib/telegram';

export interface PricingTier {
  key: string;
  months: number;
  price: number;
  labelKm: string;
  labelEn: string;
  pitchKm?: string;
  badge?: 'popular' | 'best';
  bonusEnabled: boolean;
}

// Real prices, matching the actual ABA KHQR in use — this is the
// fallback/seed shape (and the source of truth for `months`, which the
// admin-editable table below doesn't cover). Price, labels, pitch text,
// and whether the bonus spin is offered can be overridden per-tier from
// Admin Panel -> Subscriptions — see getEffectivePricingTiers().
export const PRICING_TIERS: PricingTier[] = [
  { key: '1m', months: 1, price: 3, labelKm: '១ ខែ', labelEn: '1 Month', pitchKm: 'មើលគ្មានដែនកំណត់ពេញ ១ខែ + ចាប់រង្វាន់ថ្ងៃបន្ថែម', bonusEnabled: true },
  { key: '2m', months: 1, price: 5, labelKm: '១ ខែ (Bonus ធំ)', labelEn: '1 Month (Big Bonus)', badge: 'popular', pitchKm: 'ដូចគ្នា ១ខែ ប៉ុន្តែឱកាសឈ្នះរង្វាន់ធំដល់ 100 ថ្ងៃ!', bonusEnabled: true },
  { key: '6m', months: 6, price: 16, labelKm: '៦ ខែ', labelEn: '6 Months', pitchKm: 'សន្សំសំចៃជាង — សម្រាប់អ្នកមើលទៀងទាត់', bonusEnabled: true },
  { key: '12m', months: 12, price: 27, labelKm: '១២ ខែ', labelEn: '12 Months', badge: 'best', pitchKm: 'តម្លៃល្អបំផុត — សន្សំសំចៃច្រើនបំផុត', bonusEnabled: true },
];

// Merges any admin edits (Admin Panel -> Subscriptions -> price/duration/
// description/bonus-toggle fields) onto the hardcoded defaults above.
// `months` is admin-editable too — the three server-side places that grant
// VIP time (telegram-admin-bot, auto-approve-payment, aba-payment-webhook)
// all read pricing_tiers.months live, so a change here takes effect
// immediately with no code deploy needed.
export async function getEffectivePricingTiers(): Promise<PricingTier[]> {
  const { data } = await supabase
    .from('pricing_tiers')
    .select('key, price, months, label_km, label_en, pitch_km, bonus_enabled');
  const overrides = new Map((data ?? []).map((row) => [row.key, row]));

  return PRICING_TIERS.map((tier) => {
    const o = overrides.get(tier.key);
    if (!o) return tier;
    return {
      ...tier,
      price: o.price ?? tier.price,
      months: o.months ?? tier.months,
      labelKm: o.label_km ?? tier.labelKm,
      labelEn: o.label_en ?? tier.labelEn,
      pitchKm: o.pitch_km ?? tier.pitchKm,
      bonusEnabled: o.bonus_enabled ?? tier.bonusEnabled,
    };
  });
}

export interface SubscriptionStatus {
  subscribed: boolean;
  expiresAt: string | null;
  tier: string | null;
}

function getIdentity() {
  const user = getCurrentTelegramUser();
  if (user) return { id: String(user.id), username: user.label };
  // Dev/browser fallback so testing outside Telegram still works, same
  // pattern used for the free spin.
  let deviceId = localStorage.getItem('nint_spin_device_id');
  if (!deviceId) {
    deviceId = `device_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('nint_spin_device_id', deviceId);
  }
  return { id: deviceId, username: null as string | null };
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const { id } = getIdentity();
  const { data } = await supabase
    .from('subscriptions')
    .select('expires_at, tier')
    .eq('telegram_user_id', id)
    .maybeSingle();

  if (!data?.expires_at) return { subscribed: false, expiresAt: null, tier: null };
  const subscribed = new Date(data.expires_at) > new Date();
  return { subscribed, expiresAt: data.expires_at, tier: data.tier };
}

export interface PaymentSubmission {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  tier: string;
  amount: number;
  submitted_at: string;
  telegram_user_id?: string;
  telegram_username?: string | null;
}

// Real ABA PayWay checkout for one payment — calls the aba-create-
// transaction edge function, which talks to ABA's actual Create
// Transaction API (server-side, credentials never touch the client).
// If the gateway secrets aren't set up yet, `configured` comes back
// false and the caller should fall back to the static QR / payment
// link flow — nothing breaks, it just isn't "real-time verified" yet.
export interface AbaCheckoutResult {
  configured: boolean;
  error?: string;
  tranId?: string;
  qrString?: string | null;
  deeplink?: string | null;
  checkoutUrl?: string | null;
}

export async function createAbaCheckout(submissionId: string): Promise<AbaCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('aba-create-transaction', {
    body: { submission_id: submissionId },
  });
  if (error) return { configured: false, error: error.message };
  return data as AbaCheckoutResult;
}

// Admin-editable QR images, one per tier — read by SubscriptionModal,
// written by the Admin Panel's QR Codes panel. Falls back to null (the
// modal shows a "contact admin" message) if a tier has no image yet.
export async function getQrCodes(): Promise<Record<string, string>> {
  const { data } = await supabase.from('payment_qr_codes').select('tier, image_url');
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.image_url) map[row.tier] = row.image_url;
  }
  return map;
}

// Admin-editable ABA PayWay links, one per tier (same table as the QR
// images — see database/pay-link-addition.sql). When a tier has one,
// SubscriptionModal shows a "Pay Now" button that opens it directly
// instead of requiring the viewer to save + scan the QR image.
export async function getPayLinks(): Promise<Record<string, string>> {
  const { data } = await supabase.from('payment_qr_codes').select('tier, pay_link');
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.pay_link) map[row.tier] = row.pay_link;
  }
  return map;
}

// Any submission from this Telegram account still awaiting a decision —
// used so the modal can show "already sent, waiting on admin" instead of
// letting someone submit the same payment twice.
export async function getPendingSubmission(): Promise<PaymentSubmission | null> {
  const { id } = getIdentity();
  const { data } = await supabase
    .from('payment_submissions')
    .select('id, status, tier, amount, submitted_at, telegram_user_id, telegram_username')
    .eq('telegram_user_id', id)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .maybeSingle();
  return data ?? null;
}

// Polled every few seconds while the "waiting on admin" screen is up, so
// it can flip to "you're VIP now" the instant the admin (or the 30s
// auto-approve fallback) decides.
export async function checkSubmissionStatus(id: string): Promise<PaymentSubmission['status'] | null> {
  const { data } = await supabase
    .from('payment_submissions')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  return data?.status ?? null;
}

// Fired once the 30-second grace window runs out with no admin decision
// yet — grants VIP immediately, but the submission still surfaces in the
// Admin Panel for a real review afterward (see auto-approve-payment).
export async function autoApprovePayment(submissionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.functions.invoke('auto-approve-payment', {
    body: { submission_id: submissionId },
  });
  return { error: error?.message ?? null };
}

// New "tap pay, no screenshot" flow — creates the pending submission the
// moment the viewer confirms they've paid, so the ABA auto-confirm
// webhook (aba-payment-webhook) has something to match against the
// instant their bank notification comes through the forwarder group.
// Admin still gets a Telegram message with Approve/Reject either way
// (now via sendMessage since there's no photo to attach), so a manual
// check against their own bank statement is always the fallback if the
// ABA match doesn't land.
export async function submitPaymentIntent(opts: {
  tierKey: string;
  amount: number;
  notifyAdmin?: boolean;
}): Promise<{ error: string | null; id: string | null }> {
  const { id, username } = getIdentity();

  const { data: inserted, error: insertErr } = await supabase
    .from('payment_submissions')
    .insert({
      telegram_user_id: id,
      telegram_username: username,
      tier: opts.tierKey,
      amount: opts.amount,
      screenshot_url: null,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertErr) return { error: insertErr.message, id: null };

  // Notify only when this row came from the viewer actually tapping
  // "Join VIP" (notifyAdmin), not from the background ticket recycle —
  // otherwise the admin would get a fresh DM every 3 minutes for the
  // same person sitting on the QR screen.
  if (opts.notifyAdmin) {
    notifyPendingSubmission({
      submissionId: inserted.id,
      telegramUserId: id,
      telegramUsername: username,
      tierKey: opts.tierKey,
      amount: opts.amount,
      reason: 'joined',
    });
  }

  return { error: null, id: inserted.id };
}

// Closes a payment ticket whose 3-minute listening window ran out with
// no ABA match and no receipt attached, so SubscriptionModal can open a
// clean one in its place. Runs through a SECURITY DEFINER SQL function
// (see database/auto-expire-submission-addition.sql) because viewers
// can't UPDATE payment_submissions directly — and that function can
// only ever reject, never approve, and only rows that are still
// pending, screenshot-free, and genuinely stale. Returns false if the
// helper isn't installed yet or the row no longer qualifies, in which
// case the caller keeps listening on the existing ticket rather than
// opening a duplicate.
export async function expireStaleSubmission(submissionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('expire_stale_payment_submission', {
    p_submission_id: submissionId,
  });
  if (error) return false;
  return data === true;
}

// Pings the admin's Telegram for a submission that's already sitting in
// the DB — called once the in-app listening window runs out (no
// screenshot yet, asking the admin to check their own bank statement)
// or right after attachScreenshotToSubmission (with a photo this time).
export async function notifyPendingSubmission(opts: {
  submissionId: string;
  telegramUserId: string;
  telegramUsername: string | null;
  tierKey: string;
  amount: number;
  screenshotUrl?: string | null;
  reason?: 'joined' | 'timeout' | 'proof';
}): Promise<void> {
  await supabase.functions.invoke('notify-payment-submission', {
    body: {
      submission_id: opts.submissionId,
      telegram_user_id: opts.telegramUserId,
      telegram_username: opts.telegramUsername,
      tier: opts.tierKey,
      amount: opts.amount,
      screenshot_url: opts.screenshotUrl ?? null,
      reason: opts.reason ?? 'timeout',
    },
  }).catch(() => {});
}

// Fallback path — always available alongside the QR (not gated behind
// a timeout): if the automatic ABA match hasn't confirmed yet, the
// viewer can attach a screenshot instead. This grants VIP immediately
// via the confirm-payment-proof edge function (service-role only — the
// client can't write to subscriptions directly), which also sends the
// admin the actual photo (not just a text ping) with Confirm/Revoke
// buttons for a fast retroactive check. See confirm-payment-proof's own
// comments for why an instant grant here was a deliberate choice, not
// a default I picked.
export async function attachScreenshotToSubmission(
  submissionId: string,
  screenshot: File,
): Promise<{ error: string | null; screenshotUrl: string | null }> {
  const { id } = getIdentity();
  const ext = screenshot.name.split('.').pop() || 'jpg';
  const path = `${id}/${Date.now()}.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from('payment-proofs')
    .upload(path, screenshot, { contentType: screenshot.type });
  if (uploadErr) return { error: uploadErr.message, screenshotUrl: null };

  const { data: pub } = supabase.storage.from('payment-proofs').getPublicUrl(path);

  const { error: fnError } = await supabase.functions.invoke('confirm-payment-proof', {
    body: { submission_id: submissionId, screenshot_url: pub.publicUrl },
  });
  if (fnError) return { error: fnError.message, screenshotUrl: null };

  return { error: null, screenshotUrl: pub.publicUrl };
}

export async function submitPayment(opts: {
  tierKey: string;
  amount: number;
  screenshot: File;
}): Promise<{ error: string | null }> {
  const { id, username } = getIdentity();

  const ext = opts.screenshot.name.split('.').pop() || 'jpg';
  const path = `${id}/${Date.now()}.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from('payment-proofs')
    .upload(path, opts.screenshot, { contentType: opts.screenshot.type });
  if (uploadErr) return { error: uploadErr.message };

  const { data: pub } = supabase.storage.from('payment-proofs').getPublicUrl(path);

  const { data: inserted, error: insertErr } = await supabase
    .from('payment_submissions')
    .insert({
      telegram_user_id: id,
      telegram_username: username,
      tier: opts.tierKey,
      amount: opts.amount,
      screenshot_url: pub.publicUrl,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertErr) return { error: insertErr.message };

  // Fire-and-forget: tells the admin's Telegram immediately with an
  // Approve/Reject button. If this fails the submission still exists and
  // shows up in the Admin Panel's Payments queue either way.
  supabase.functions.invoke('notify-payment-submission', {
    body: {
      submission_id: inserted.id,
      telegram_user_id: id,
      telegram_username: username,
      tier: opts.tierKey,
      amount: opts.amount,
      screenshot_url: pub.publicUrl,
    },
  }).catch(() => {});

  return { error: null };
}
