import { supabase } from '@/lib/supabase/supabaseClient';
import type { Show, ShowWithGenres, Episode, Genre } from '@/lib/types';

interface ShowGenreJoin {
  genre_id: string;
  genres: Genre | null;
}

interface ShowWithGenreData extends Omit<Show, 'genres'> {
  show_genres: ShowGenreJoin[];
}

export async function fetchShowcaseShows(limit = 8): Promise<Show[]> {
  const { data, error } = await supabase
    .from('shows')
    .select('*')
    .order('featured', { ascending: false })
    .order('rating', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function fetchFeaturedShows(): Promise<Show[]> {
  const { data, error } = await supabase
    .from('shows')
    .select('*')
    .eq('featured', true)
    .order('rating', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchTickerMessage(): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ticker_message')
    .maybeSingle();
  if (error) return null; // table/row may not exist on older deploys — ticker just falls back
  return data?.value ?? null;
}

export async function saveTickerMessage(value: string): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'ticker_message', value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function fetchAbaMerchantName(): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'aba_merchant_name')
    .maybeSingle();
  if (error) return null;
  return data?.value ?? null;
}

export async function saveAbaMerchantName(value: string): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'aba_merchant_name', value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export interface TelegramAutoPostSettings {
  enabled: boolean;
  interval_minutes: number;
  shows_per_run: number;
  last_run_at: string | null;
}

export async function fetchTelegramAutoPostSettings(): Promise<TelegramAutoPostSettings | null> {
  const { data, error } = await supabase
    .from('telegram_auto_post_settings')
    .select('enabled, interval_minutes, shows_per_run, last_run_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) return null; // table may not exist yet on older deploys
  return data ?? null;
}

export async function saveTelegramAutoPostSettings(
  settings: Pick<TelegramAutoPostSettings, 'enabled' | 'interval_minutes' | 'shows_per_run'>,
): Promise<void> {
  const { error } = await supabase
    .from('telegram_auto_post_settings')
    .update({ ...settings, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw error;
}

export async function fetchAllShows(): Promise<ShowWithGenres[]> {
  const { data, error } = await supabase
    .from('shows')
    .select('*, show_genres(genre_id, genres(id, name, slug))')
    .order('rating', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((s: ShowWithGenreData) => {
    const { show_genres: _removed, ...rest } = s;
    void _removed;
    const genres: Genre[] = (s.show_genres ?? [])
      .map((sg) => sg.genres)
      .filter((g): g is Genre => g !== null);
    return { ...rest, genres } as ShowWithGenres;
  });
}

export async function fetchGenres(): Promise<Genre[]> {
  const { data, error } = await supabase
    .from('genres')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Latest episode timestamp per show — used to power the "Now Airing"
// rail (shows that have genuinely posted a new episode recently) rather
// than reusing the show's own created_at, which only reflects when the
// show entry itself was added, not whether it's still actively updating.
export interface ShowEpisodeInfo {
  /** When the newest episode was added — "is this show still running". */
  latestAt: string;
  /** Highest episode number published, i.e. what a card should advertise. */
  latestEpisode: number;
}

export async function fetchShowEpisodeInfo(): Promise<Record<string, ShowEpisodeInfo>> {
  const { data, error } = await supabase
    .from('episodes')
    .select('show_id, created_at, episode_number')
    .order('created_at', { ascending: false });
  if (error) return {};
  const info: Record<string, ShowEpisodeInfo> = {};
  for (const ep of data ?? []) {
    const current = info[ep.show_id];
    if (!current) {
      // Rows arrive newest-first, so the first one seen for a show is its
      // latest air date.
      info[ep.show_id] = { latestAt: ep.created_at, latestEpisode: ep.episode_number ?? 0 };
    } else if ((ep.episode_number ?? 0) > current.latestEpisode) {
      current.latestEpisode = ep.episode_number ?? 0;
    }
  }
  return info;
}

export async function fetchShowById(id: string): Promise<ShowWithGenres | null> {
  const { data, error } = await supabase
    .from('shows')
    .select('*, show_genres(genre_id, genres(id, name, slug))')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const d = data as ShowWithGenreData;
  const { show_genres: _removed, ...rest } = d;
  void _removed;
  const genres: Genre[] = (d.show_genres ?? [])
    .map((sg) => sg.genres)
    .filter((g): g is Genre => g !== null);
  return { ...rest, genres } as ShowWithGenres;
}

export async function fetchEpisodesByShow(showId: string): Promise<Episode[]> {
  const { data, error } = await supabase
    .from('episodes')
    .select('*')
    .eq('show_id', showId)
    .order('season', { ascending: true })
    .order('episode_number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ---------- Blocked Telegram users (copyright block screen) ----------

export interface BlockedTelegramUser {
  id: string;
  telegram_user_id: string | null;
  telegram_username: string | null;
  reason: string | null;
  created_at: string;
}

// Checked once on app boot against the viewer's own Telegram identity
// (see getCurrentTelegramProfile in lib/telegram.ts). Matches on either
// the numeric id or the @username, whichever the admin entered — a
// viewer only needs one of the two to hit a block.
export async function checkTelegramUserBlocked(
  telegramId: number,
  username: string | null,
): Promise<{ blocked: boolean; reason: string | null }> {
  const idStr = String(telegramId);
  const usernameLower = username ? username.toLowerCase() : null;
  const orFilter = usernameLower
    ? `telegram_user_id.eq.${idStr},telegram_username.eq.${usernameLower}`
    : `telegram_user_id.eq.${idStr}`;
  const { data, error } = await supabase
    .from('blocked_telegram_users')
    .select('reason')
    .or(orFilter)
    .limit(1)
    .maybeSingle();
  if (error) return { blocked: false, reason: null }; // table may not exist yet on older deploys
  return { blocked: !!data, reason: data?.reason ?? null };
}

export async function fetchBlockedTelegramUsers(): Promise<BlockedTelegramUser[]> {
  const { data, error } = await supabase
    .from('blocked_telegram_users')
    .select('id, telegram_user_id, telegram_username, reason, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addBlockedTelegramUser(entry: {
  telegram_user_id?: string;
  telegram_username?: string;
  reason?: string;
}): Promise<void> {
  const { error } = await supabase.from('blocked_telegram_users').insert({
    telegram_user_id: entry.telegram_user_id || null,
    telegram_username: entry.telegram_username || null,
    reason: entry.reason || null,
  });
  if (error) throw error;
}

export async function removeBlockedTelegramUser(id: string): Promise<void> {
  const { error } = await supabase.from('blocked_telegram_users').delete().eq('id', id);
  if (error) throw error;
}
