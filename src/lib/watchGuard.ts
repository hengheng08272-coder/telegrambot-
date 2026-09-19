import { supabase } from '@/lib/supabase/supabaseClient';
import { getCurrentTelegramUser } from '@/lib/telegram';

/**
 * The warning a viewer sees when their watching looked like a download.
 *
 * Detection used to be silent: a flag landed in an admin table and the
 * viewer found out only if they were eventually blocked, with no idea
 * what they had done. That is the wrong way round — most flags are a
 * misunderstanding, and a misunderstanding can only be cleared up by
 * saying something. So the first two strikes are spoken out loud, in the
 * viewer's own language, with what to do instead; the third is the ban.
 */
export interface WatchWarning {
  id: string;
  level: 'warning' | 'ban';
  strike: number;
  distinct_episodes: number | null;
  window_minutes: number;
}

export async function fetchMyWatchWarning(): Promise<WatchWarning | null> {
  const user = getCurrentTelegramUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc('get_my_watch_warning', {
    p_telegram_user_id: String(user.id),
  });
  // A deploy where the function does not exist yet must not break the app
  // — the warning is an extra, never a gate.
  if (error) return null;
  const row = (data as WatchWarning[] | null)?.[0];
  return row ?? null;
}

export async function acknowledgeWatchWarning(id: string): Promise<void> {
  const user = getCurrentTelegramUser();
  if (!user) return;
  await supabase.rpc('ack_watch_warning', {
    p_telegram_user_id: String(user.id),
    p_id: id,
  });
}
