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

// Marketing bonus spin, unlocked once per approved VIP purchase.
//
// Capped at 10 bonus days per person, by the owner's decision. Every
// plan draws from the SAME pool: the bonus is a thank-you on top of a
// plan that was already paid for, not a second product, and one shared
// pool means the odds are the same for a $3 buyer and a $27 one and
// there is only one table to keep in sync.
//
// A tier still has to be listed in BONUS_POOLS to offer a draw at all,
// and the admin can switch any tier's bonus off from Admin Panel ->
// Subscriptions (pricing_tiers.bonus_enabled) without touching code.
//
// This copy exists to DRAW THE WHEEL — the slices the viewer sees have
// to be the ones that can actually come up. It does not decide anything:
// the roll, the eligibility check and the grant all happen inside the
// claim-bonus-spin edge function, which keeps the authoritative copy of
// this pool. Keep the two in sync when editing either.
export const BONUS_POOL: RewardTier[] = [
  { key: '1d', label: '1 day', days: 1, weight: 30 },
  { key: '2d', label: '2 days', days: 2, weight: 22 },
  { key: '3d', label: '3 days', days: 3, weight: 18 },
  { key: '5d', label: '5 days', days: 5, weight: 14 },
  { key: '7d', label: '7 days', days: 7, weight: 10 },
  { key: '10d', label: '10 days', days: 10, weight: 6 },
];

export const BONUS_POOLS: Record<string, RewardTier[]> = {
  '1m': BONUS_POOL,
  '2m': BONUS_POOL,
  '6m': BONUS_POOL,
  '12m': BONUS_POOL,
};

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

export interface BonusSpinInfo {
  submissionId: string;
  tier: string;
}

// Checks whether this Telegram account has an approved purchase whose
// bonus spin hasn't been claimed yet — and whose tier actually has a
// reward pool defined (BONUS_POOLS). Returns the most recent one if
// several are somehow pending.
//
// Advisory only. This decides whether to SHOW the draw; claim-bonus-spin
// re-checks every one of these conditions against the service role
// before granting anything, so a stale or tampered answer here costs a
// wasted modal, not free days.
export async function getAvailableBonusSpin(): Promise<BonusSpinInfo | null> {
  const { id: telegramUserId } = getTelegramIdentity();

  // The draw is for VIPs, and specifically for CURRENT ones. Gating on
  // "has an approved purchase" instead (which is what this used to do)
  // kept offering the draw to accounts whose membership lapsed months
  // ago, since an approved payment stays approved forever.
  const { data: subRows } = await supabase.rpc('get_my_subscription', {
    p_telegram_user_id: telegramUserId,
  });
  const subscription = (subRows as { expires_at: string }[] | null)?.[0];
  if (!subscription?.expires_at || new Date(subscription.expires_at) <= new Date()) return null;

  const { data } = await supabase.rpc('get_my_unclaimed_bonus_purchases', {
    p_telegram_user_id: telegramUserId,
  });

  const candidates = ((data ?? []) as { id: string; tier: string }[]).filter(
    (row) => BONUS_POOLS[row.tier],
  );
  if (candidates.length === 0) return null;

  // The admin can turn a tier's bonus off from Admin Panel -> Subscriptions
  // without touching code — check that toggle before offering a spin for
  // any of the tiers this account has an unclaimed purchase for.
  const { data: tierRows } = await supabase
    .from('pricing_tiers')
    .select('key, bonus_enabled')
    .in('key', candidates.map((c) => c.tier));
  const enabledKeys = new Set((tierRows ?? []).filter((t) => t.bonus_enabled).map((t) => t.key));

  const eligible = candidates.find((row) => enabledKeys.has(row.tier) || tierRows === null);
  return eligible ? { submissionId: eligible.id, tier: eligible.tier } : null;
}

export async function claimBonusSpin(
  info: BonusSpinInfo,
): Promise<{ data: SpinResult | null; error: string | null }> {
  // Every part of this — eligibility, the roll, the once-only guard and
  // adding the days to expires_at — happens inside the edge function.
  // The client used to do the first three itself and simply never did
  // the fourth, so winners were told they had won and given nothing.
  const { data, error } = await supabase.functions.invoke('claim-bonus-spin', {
    body: { submission_id: info.submissionId },
  });

  // A non-2xx from the function surfaces as `error` with the body
  // unparsed, so the reason ('already_used', 'not_vip', ...) has to be
  // read back off the response to tell the viewer something useful
  // instead of a generic failure.
  if (error) {
    let reason = error.message;
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) reason = body.error;
    } catch {
      // Body already consumed or not JSON — keep the generic message.
    }
    return { data: null, error: reason };
  }

  const result = data as { reward_days?: number; reward_label?: string; error?: string } | null;
  if (!result || result.error) return { data: null, error: result?.error ?? 'unknown' };

  return {
    data: { reward_days: result.reward_days!, reward_label: result.reward_label! },
    error: null,
  };
}
