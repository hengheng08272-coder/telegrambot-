import { supabase } from '@/lib/supabase/supabaseClient';
import { getCurrentTelegramUser } from '@/lib/telegram';

// Called once, on app open, when the start param is `ref_<telegram_id>`
// (see App.tsx). Just records "this viewer was referred by that
// person" — no reward happens here. The actual VIP-days reward is
// granted server-side, in telegram-admin-bot/index.ts, the moment this
// viewer's own first payment gets approved (see
// database/referral-addition.sql for the full flow).
//
// Uses upsert with ignoreDuplicates on the UNIQUE referred_telegram_id
// column so this is safe to call on every app open without creating
// duplicate rows or re-attributing someone who already has a referrer
// on file from a previous visit (first touch wins).
export async function recordReferralIfPresent(referrerTelegramId: string): Promise<void> {
  const me = getCurrentTelegramUser();
  if (!me) return;

  const referredId = String(me.id);
  // No self-referrals, and no rewarding a link a bot/scraper opened
  // with a garbage id.
  if (!referrerTelegramId || referrerTelegramId === referredId) return;

  await supabase
    .from('referrals')
    .upsert(
      { referrer_telegram_id: referrerTelegramId, referred_telegram_id: referredId },
      { onConflict: 'referred_telegram_id', ignoreDuplicates: true },
    );
}

export interface ReferralStats {
  totalReferred: number;
  rewardedCount: number;
  totalBonusDays: number;
}

// Powers the "Invite & Earn" card on the Account screen — how many
// friends this viewer has referred so far, how many of those turned
// into an approved VIP purchase, and how many bonus days that's earned
// them in total.
export async function getReferralStats(): Promise<ReferralStats> {
  const me = getCurrentTelegramUser();
  if (!me) return { totalReferred: 0, rewardedCount: 0, totalBonusDays: 0 };

  const { data } = await supabase
    .from('referrals')
    .select('rewarded, reward_days')
    .eq('referrer_telegram_id', String(me.id));

  const rows = data ?? [];
  const rewarded = rows.filter((r) => r.rewarded);
  return {
    totalReferred: rows.length,
    rewardedCount: rewarded.length,
    totalBonusDays: rewarded.reduce((sum, r) => sum + (r.reward_days ?? 0), 0),
  };
}
