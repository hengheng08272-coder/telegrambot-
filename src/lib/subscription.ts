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

// Seed/fallback shape only — used when a tier has no row in
// `pricing_tiers` yet. Price, DURATION (months), both labels, pitch text
// and the bonus-spin toggle are all admin-editable per tier from Admin
// Panel -> Subscriptions and override everything here at runtime; see
// getEffectivePricingTiers(). `key` and `badge` are the only things still
// fixed in code.
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

export interface SubscriptionDetail extends SubscriptionStatus {
  /** When the current period was last granted/extended. The table has no
   *  separate start column — `updated_at` is stamped every time VIP time
   *  is added, so it is the honest "this period began" marker. */
  startedAt: string | null;
}

// Everything the account screen needs to answer "how long have I got
// left, and out of how long" in one round trip.
export async function getSubscriptionDetail(): Promise<SubscriptionDetail> {
  const { id } = getIdentity();
  const { data } = await supabase
    .from('subscriptions')
    .select('expires_at, tier, updated_at')
    .eq('telegram_user_id', id)
    .maybeSingle();

  if (!data?.expires_at) {
    return { subscribed: false, expiresAt: null, tier: null, startedAt: null };
  }
  return {
    subscribed: new Date(data.expires_at) > new Date(),
    expiresAt: data.expires_at,
    tier: data.tier,
    startedAt: data.updated_at ?? null,
  };
}

export interface PaymentHistoryRow {
  id: string;
  tier: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  aba_trx_id?: string | null;
}

// This viewer's own payments, newest first — the "have I actually been
// charged for this" record. Uses select('*') because aba_trx_id only
// exists after database/aba-trx-id-addition.sql, and a history list
// should degrade rather than error out.
export async function getMyPayments(limit = 20): Promise<PaymentHistoryRow[]> {
  const { id } = getIdentity();
  const { data } = await supabase
    .from('payment_submissions')
    .select('*')
    .eq('telegram_user_id', id)
    .order('submitted_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as PaymentHistoryRow[];
}

// Which plans are currently offered in the picker. This lives in
// app_settings (comma-separated keys) rather than in code, because the
// last time it was hardcoded the '2m' slot was hidden as the old "Big
// Bonus" plan, then later re-purposed as the 3-month / $5 plan — and it
// stayed invisible to every viewer even though the admin had priced it,
// named it and attached a QR to it. A plan the admin can configure must
// be a plan the admin can also un-hide, without a code change.
const HIDDEN_TIERS_SETTING_KEY = 'hidden_tier_keys';

export async function getHiddenTierKeys(): Promise<Set<string>> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', HIDDEN_TIERS_SETTING_KEY)
    .maybeSingle();
  return new Set(
    (data?.value ?? '')
      .split(',')
      .map((key: string) => key.trim())
      .filter(Boolean),
  );
}

export async function setHiddenTierKeys(keys: Iterable<string>): Promise<void> {
  const value = [...new Set(keys)].filter(Boolean).join(',');
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: HIDDEN_TIERS_SETTING_KEY, value }, { onConflict: 'key' });
  if (error) throw error;
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

// The KHQR for one payment ticket, issued by the khqr-issue edge
// function rather than built in this browser.
//
// Three things move server-side by asking for it there. The AMOUNT comes
// from pricing_tiers keyed by the ticket's own tier, so the QR asks for
// what the owner set rather than what this client claimed. The PAYLOAD
// is stored on the ticket, so a re-render or a second tab gets the same
// bytes — and therefore the same md5, which is the handle
// check_transaction_by_md5 answers about, so a ticket whose md5 drifted
// is a payment nothing could confirm. And the ADMIN PREVIEW calls this
// same function, so what the owner tested is what a member receives.
//
// `configured: false` means the owner has not pasted a KHQR template (or
// the function is not deployed): the caller falls back to building one
// locally with generateKhqrDetailed, and failing that to the uploaded QR
// image. Nothing here is load-bearing on its own.
export interface IssuedKhqr {
  configured: boolean;
  error?: string;
  payload?: string;
  md5?: string;
  /** Read back out of the payload's tag 59 — the name the payer will see. */
  payeeName?: string | null;
  amount?: number;
  expiresAt?: string;
}

export async function issueKhqr(
  opts: { submissionId: string } | { preview: true; amount: number },
): Promise<IssuedKhqr> {
  const body =
    'preview' in opts
      ? { preview: true, amount: opts.amount }
      : { submission_id: opts.submissionId };
  const { data, error } = await supabase.functions.invoke('khqr-issue', { body });
  // A transport-level failure is reported as "not configured" so the
  // caller takes the same fallback it would if the owner had never set
  // this up. Being unable to reach the issuer must never be the reason a
  // member cannot pay.
  if (error) return { configured: false, error: error.message };
  return data as IssuedKhqr;
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

// KHQR payloads decoded from each tier's QR image at upload time (see
// SubscriptionsPanel). Having these stored means SubscriptionModal can
// build the one-tap ABA deeplink instantly, without re-downloading and
// re-decoding the image in the viewer's browser -- which is both slower
// and dependent on the storage host's CORS headers.
export async function getKhqrStrings(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('payment_qr_codes').select('tier, khqr_string');
  // The column is added by database/khqr-string-addition.sql. Until that
  // has been run the select errors; fall back to an empty map so the
  // modal quietly reverts to decoding the image itself.
  if (error) return {};
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.khqr_string) map[row.tier] = row.khqr_string;
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
  // `.limit(1)` and not `.maybeSingle()`: maybeSingle ERRORS when the
  // query matches more than one row, and an account really can end up
  // with two open tickets — cancel_payment_submission not being installed
  // yet, or a cancel that lost a race with the insert, both leave the old
  // row pending. That error came back as "no pending submission at all",
  // so the modal forgot a live ticket and opened yet another one. Newest
  // row wins instead.
  const { data } = await supabase
    .from('payment_submissions')
    .select('id, status, tier, amount, submitted_at, telegram_user_id, telegram_username')
    .eq('telegram_user_id', id)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
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

// Everything a payer expects to see on a confirmation screen once the
// payment lands: what they bought, what it cost, the bank's own
// reference (ABA's "Trx. ID", pulled out of the notification text by
// aba-notify-ingest) and when the membership runs out. `select('*')` on
// purpose — aba_trx_id only exists once database/aba-trx-id-addition.sql
// has been run, and a receipt should degrade to the internal id rather
// than error out.
export interface PaymentReceipt {
  id: string;
  tier: string;
  amount: number;
  abaTrxId: string | null;
  expiresAt: string | null;
}

export async function getPaymentReceipt(submissionId: string): Promise<PaymentReceipt | null> {
  const { data } = await supabase
    .from('payment_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const status = await getSubscriptionStatus();
  return {
    id: String(row.id),
    tier: String(row.tier ?? ''),
    amount: Number(row.amount ?? 0),
    abaTrxId: (row.aba_trx_id as string | null) ?? null,
    expiresAt: status.expiresAt,
  };
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

// Creates the pending submission the moment the viewer taps "Join VIP" /
// the ticket gets recycled, so the ABA auto-confirm webhook
// (aba-payment-webhook) has something to match against the instant their
// bank notification comes through the forwarder group.
//
// `notifyAdmin` is deliberately NOT set from SubscriptionModal any more —
// pinging the admin the moment someone opens the QR screen (before they've
// necessarily paid anything) was too noisy. The admin is now only pinged
// once there's something real to review: an ABA webhook match, or the
// viewer submitting a receipt photo on the Manual tab (see
// attachScreenshotToSubmission / confirm-payment-proof). The flag is kept
// here, unused by the current UI, as an opt-in escape hatch rather than
// deleted outright.
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

// Closes a ticket the viewer wants to abandon on purpose — e.g. they tap
// "Change Plan" on the pay screen because they want a different tier.
// Unlike expireStaleSubmission this has no 150-second floor: it cancels
// immediately, regardless of how long the ticket has been open. Runs
// through the same kind of narrow SECURITY DEFINER function (see
// database/cancel-submission-addition.sql) since viewers can't UPDATE
// payment_submissions directly. Returns false if the helper isn't
// installed yet or the row is no longer pending (already decided by
// something else) — the caller can proceed to the picker regardless,
// since either way there's nothing left to wait on.
export async function cancelPaymentSubmission(submissionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancel_payment_submission', {
    p_submission_id: submissionId,
  });
  if (error) return false;
  return data === true;
}

// Asks Bakong whether the QR generated for this ticket has been paid.
//
// Unlike every other confirm path here, this one is a question put to the
// bank rather than a claim made to the server: the edge function grants
// nothing unless Bakong reports the payload as paid, for the ticket's
// exact amount, to the owner's account, with a transaction id never used
// before. See supabase/functions/bakong-verify for the full reasoning.
//
// Silent on failure by design — an unconfigured token, an offline
// network or a payment that simply hasn't happened yet must all read as
// "keep waiting", which is what the surrounding poll already does.
export async function checkBakongPayment(
  submissionId: string,
  md5: string,
): Promise<'granted' | 'waiting'> {
  try {
    const { data, error } = await supabase.functions.invoke('bakong-verify', {
      body: { submission_id: submissionId, md5 },
    });
    if (error) return 'waiting';
    return (data as { granted?: boolean } | null)?.granted ? 'granted' : 'waiting';
  } catch {
    return 'waiting';
  }
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
