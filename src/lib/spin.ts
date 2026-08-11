import { supabase } from '@/lib/supabase/supabaseClient';
import { getTelegramWebApp } from '@/lib/telegram';

export interface SpinResult {
  reward_days: number;
  reward_label: string;
}

export interface RewardTier {
  key: string;
  label: string;
  days: number;
  weight: number;
}

// The general free-forever spin every viewer gets once, regardless of
// whether they ever buy VIP. Finer day increments for variety, plus a
// 1-month jackpot capped at the first 5 winners overall.
export const SPIN_TIERS: RewardTier[] = [
  { key: '1d', label: '1 day', days: 1, weight: 30 },
  { key: '2d', label: '2 days', days: 2, weight: 22 },
  { key: '3d', label: '3 days', days: 3, weight: 16 },
  { key: '5d', label: '5 days', days: 5, weight: 12 },
  { key: '7d', label: '7 days', days: 7, weight: 8 },
  { key: '10d', label: '10 days', days: 10, weight: 5 },
  { key: '15d', label: '15 days', days: 15, weight: 3 },
  { key: '20d', label: '20 days', days: 20, weight: 1.5 },
  { key: '1m', label: '1 month', days: 30, weight: 0.5 },
];

const JACKPOT_KEY = '1m';
const JACKPOT_MAX_WINNERS = 5;

// Marketing bonus spin, unlocked once per approved VIP purchase. The
// reward range scales with what they paid for — buying the pricier plan
// gets access to a bigger bonus-day range, on top of the plan itself.
// Only tiers listed here grant a bonus spin; a tier with no entry here
// (e.g. 6m/12m, until a pool is defined for them) just doesn't offer one.
export const BONUS_POOLS: Record<string, RewardTier[]> = {
  '1m': [
    { key: '5d', label: '5 days', days: 5, weight: 50 },
    { key: '10d', label: '10 days', days: 10, weight: 35 },
    { key: '15d', label: '15 days', days: 15, weight: 15 },
  ],
  '2m': [
    { key: '30d', label: '30 days', days: 30, weight: 40 },
    { key: '40d', label: '40 days', days: 40, weight: 30 },
    { key: '50d', label: '50 days', days: 50, weight: 20 },
    { key: '60d', label: '60 days', days: 60, weight: 10 },
  ],
};

function pickWeightedReward(pool: RewardTier[]): RewardTier {
  const total = pool.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * total;
  for (const tier of pool) {
    if (roll < tier.weight) return tier;
    roll -= tier.weight;
  }
  return pool[0];
}

function getTelegramIdentity(): { id: string; username: string | null } {
  const user = getTelegramWebApp()?.initDataUnsafe?.user;
  if (user) {
    return { id: String(user.id), username: user.username ?? user.first_name ?? null };
  }
  let deviceId = localStorage.getItem('nint_spin_device_id');
  if (!deviceId) {
    deviceId = `device_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('nint_spin_device_id', deviceId);
  }
  return { id: deviceId, username: null };
}

// One free spin, ever, per Telegram account — enforced by the unique
// (telegram_user_id, source='free') index in the database as a backstop.
export async function claimSpin(): Promise<{ data: SpinResult | null; error: string | null }> {
  const { id: telegramUserId, username } = getTelegramIdentity();

  const { data: existing, error: checkErr } = await supabase
    .from('spin_claims')
    .select('id')
    .eq('telegram_user_id', telegramUserId)
    .eq('source', 'free')
    .maybeSingle();

  if (checkErr) return { data: null, error: checkErr.message };
  if (existing) return { data: null, error: 'already_used' };

  const { count: jackpotWinners } = await supabase
    .from('spin_claims')
    .select('id', { count: 'exact', head: true })
    .eq('reward_label', SPIN_TIERS.find((t) => t.key === JACKPOT_KEY)!.label);

  const pool = (jackpotWinners ?? 0) >= JACKPOT_MAX_WINNERS
    ? SPIN_TIERS.filter((t) => t.key !== JACKPOT_KEY)
    : SPIN_TIERS;

  const tier = pickWeightedReward(pool);

  const { error: insertErr } = await supabase.from('spin_claims').insert({
    telegram_user_id: telegramUserId,
    telegram_username: username,
    source: 'free',
    reward_days: tier.days,
    reward_label: tier.label,
  });

  if (insertErr) return { data: null, error: insertErr.message };
  return { data: { reward_days: tier.days, reward_label: tier.label }, error: null };
}

export interface BonusSpinInfo {
  submissionId: string;
  tier: string;
}

// Checks whether this Telegram account has an approved purchase whose
// bonus spin hasn't been claimed yet — and whose tier actually has a
// reward pool defined (BONUS_POOLS). Returns the most recent one if
// several are somehow pending.
export async function getAvailableBonusSpin(): Promise<BonusSpinInfo | null> {
  const { id: telegramUserId } = getTelegramIdentity();
  const { data } = await supabase
    .from('payment_submissions')
    .select('id, tier')
    .eq('telegram_user_id', telegramUserId)
    .eq('status', 'approved')
    .eq('bonus_spin_claimed', false)
    .order('submitted_at', { ascending: false });

  const eligible = (data ?? []).find((row) => BONUS_POOLS[row.tier]);
  return eligible ? { submissionId: eligible.id, tier: eligible.tier } : null;
}

export async function claimBonusSpin(
  info: BonusSpinInfo,
): Promise<{ data: SpinResult | null; error: string | null }> {
  const pool = BONUS_POOLS[info.tier];
  if (!pool) return { data: null, error: 'no_pool' };

  const { id: telegramUserId, username } = getTelegramIdentity();
  const source = `purchase:${info.submissionId}`;

  const { data: existing } = await supabase
    .from('spin_claims')
    .select('id')
    .eq('telegram_user_id', telegramUserId)
    .eq('source', source)
    .maybeSingle();
  if (existing) return { data: null, error: 'already_used' };

  const tier = pickWeightedReward(pool);

  const { error: insertErr } = await supabase.from('spin_claims').insert({
    telegram_user_id: telegramUserId,
    telegram_username: username,
    source,
    reward_days: tier.days,
    reward_label: tier.label,
  });
  if (insertErr) return { data: null, error: insertErr.message };

  await supabase
    .from('payment_submissions')
    .update({ bonus_spin_claimed: true })
    .eq('id', info.submissionId);

  return { data: { reward_days: tier.days, reward_label: tier.label }, error: null };
}
