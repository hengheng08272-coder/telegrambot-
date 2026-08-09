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

// Free, one-time lucky draw for VIP members — a small retention perk,
// not a paid game. Small day increments, plus a 1-month jackpot that's
// only available to the first 5 winners overall — once claimed 5 times,
// it drops out of the wheel and everyone spins among the smaller tiers.
export const SPIN_TIERS: RewardTier[] = [
  { key: '2d', label: '2 days', days: 2, weight: 40 },
  { key: '4d', label: '4 days', days: 4, weight: 28 },
  { key: '6d', label: '6 days', days: 6, weight: 18 },
  { key: '8d', label: '8 days', days: 8, weight: 9 },
  { key: '10d', label: '10 days', days: 10, weight: 4 },
  { key: '1m', label: '1 month', days: 30, weight: 1 },
];

const JACKPOT_KEY = '1m';
const JACKPOT_MAX_WINNERS = 5;

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

// One spin, ever, per Telegram account — enforced by a unique index on
// spin_claims.telegram_user_id in the database as a backstop.
export async function claimSpin(): Promise<{ data: SpinResult | null; error: string | null }> {
  const { id: telegramUserId, username } = getTelegramIdentity();

  const { data: existing, error: checkErr } = await supabase
    .from('spin_claims')
    .select('id')
    .eq('telegram_user_id', telegramUserId)
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
    reward_days: tier.days,
    reward_label: tier.label,
  });

  if (insertErr) return { data: null, error: insertErr.message };
  return { data: { reward_days: tier.days, reward_label: tier.label }, error: null };
}
