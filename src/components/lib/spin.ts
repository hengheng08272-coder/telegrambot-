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
// not a paid game. Modest rewards only, capped at 1 month.
export const SPIN_TIERS: RewardTier[] = [
  { key: '10d', label: '10 days', days: 10, weight: 50 },
  { key: '15d', label: '15 days', days: 15, weight: 30 },
  { key: '20d', label: '20 days', days: 20, weight: 15 },
  { key: '1m', label: '1 month', days: 30, weight: 5 },
];

function pickWeightedReward(): RewardTier {
  const total = SPIN_TIERS.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * total;
  for (const tier of SPIN_TIERS) {
    if (roll < tier.weight) return tier;
    roll -= tier.weight;
  }
  return SPIN_TIERS[0];
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

  const tier = pickWeightedReward();

  const { error: insertErr } = await supabase.from('spin_claims').insert({
    telegram_user_id: telegramUserId,
    telegram_username: username,
    reward_days: tier.days,
    reward_label: tier.label,
  });

  if (insertErr) return { data: null, error: insertErr.message };
  return { data: { reward_days: tier.days, reward_label: tier.label }, error: null };
}
