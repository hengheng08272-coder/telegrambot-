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

// Merges any admin edits (Admin Panel -> Subscriptions -> price/
// description/bonus-toggle fields) onto the hardcoded defaults above.
// `months` and `badge` always come from the code — only price/labels/
// pitch/bonusEnabled are admin-editable, since months drives real
// subscription-length math and shouldn't be freeform-editable without
// also touching the code that reasons about it.
export async function getEffectivePricingTiers(): Promise<PricingTier[]> {
  const { data } = await supabase
    .from('pricing_tiers')
    .select('key, price, label_km, label_en, pitch_km, bonus_enabled');
  const overrides = new Map((data ?? []).map((row) => [row.key, row]));

  return PRICING_TIERS.map((tier) => {
    const o = overrides.get(tier.key);
    if (!o) return tier;
    return {
      ...tier,
      price: o.price ?? tier.price,
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

// Any submission from this Telegram account still awaiting a decision —
// used so the modal can show "already sent, waiting on admin" instead of
// letting someone submit the same payment twice.
export async function getPendingSubmission(): Promise<PaymentSubmission | null> {
  const { id } = getIdentity();
  const { data } = await supabase
    .from('payment_submissions')
    .select('id, status, tier, amount, submitted_at')
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
