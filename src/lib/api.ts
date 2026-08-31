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

// 'rotate' gives every show a turn, least recently posted first;
// 'queue' posts only the shows the admin picked, in the admin's order.
export type TelegramAutoPostMode = 'rotate' | 'queue';

export interface TelegramAutoPostSettings {
  enabled: boolean;
  interval_minutes: number;
  shows_per_run: number;
  selection_mode: TelegramAutoPostMode;
  last_run_at: string | null;
}

// Mirrors the column defaults in database/telegram-auto-post-addition.sql,
// used when the settings row hasn't been created yet (the first save
// upserts it back into existence).
export const TELEGRAM_AUTO_POST_DEFAULTS: TelegramAutoPostSettings = {
  enabled: false,
  interval_minutes: 180,
  shows_per_run: 1,
  selection_mode: 'rotate',
  last_run_at: null,
};

export const TELEGRAM_AUTO_POST_MIN_INTERVAL_MINUTES = 5;

// The two failures that actually happen in this project are "the migration
// was never run" and "this session isn't an admin, so RLS hid the row" —
// both of which used to surface as a blank panel quietly showing default
// values. Turning them into a sentence the admin can act on is the whole
// point of this helper.
function describeAutoPostError(error: { code?: string; message: string }): string {
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return 'Table telegram_auto_post_settings not found — run database/telegram-auto-post-addition.sql in the Supabase SQL editor first.';
  }
  if (error.code === '42501' || error.code === 'PGRST301') {
    return 'Not allowed to read/write the auto-post settings — sign in with an admin account (profiles.is_admin = true).';
  }
  return error.message;
}

// `selection_mode` and the queue table arrived after the first version of
// this feature shipped, so a project that hasn't re-run the migration yet
// still has the older shape. Rather than breaking the whole panel with
// "column ... does not exist", the loader notices, remembers, and runs in
// rotate-only mode until the migration is applied.
let selectionModeSupported: boolean | null = null;

const SETTINGS_COLUMNS = 'enabled, interval_minutes, shows_per_run, last_run_at';
const SETTINGS_COLUMNS_WITH_MODE = `enabled, interval_minutes, shows_per_run, selection_mode, last_run_at`;

// PostgREST reports an unknown column as 42703 / PGRST204 depending on
// whether it fails in Postgres or in PostgREST's own schema cache.
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .* does not exist/i.test(error.message ?? '')
  );
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205';
}

/** False when the migration adding selection_mode / the queue table hasn't been run. */
export function autoPostQueueSupported(): boolean {
  return selectionModeSupported !== false;
}

export async function fetchTelegramAutoPostSettings(): Promise<TelegramAutoPostSettings> {
  if (selectionModeSupported !== false) {
    const { data, error } = await supabase
      .from('telegram_auto_post_settings')
      .select(SETTINGS_COLUMNS_WITH_MODE)
      .eq('id', 1)
      .maybeSingle();
    if (!error) {
      selectionModeSupported = true;
      return data ?? { ...TELEGRAM_AUTO_POST_DEFAULTS };
    }
    if (!isMissingColumn(error)) throw new Error(describeAutoPostError(error));
    selectionModeSupported = false;
  }

  const { data, error } = await supabase
    .from('telegram_auto_post_settings')
    .select(SETTINGS_COLUMNS)
    .eq('id', 1)
    .maybeSingle();
  if (error) throw new Error(describeAutoPostError(error));
  return { ...TELEGRAM_AUTO_POST_DEFAULTS, ...(data ?? {}), selection_mode: 'rotate' };
}

// Upsert, not update: an UPDATE ... WHERE id = 1 that matches no row (the
// seed INSERT never ran, or RLS hides it) reports success while saving
// nothing, so the panel would show "Saved" and the bot would keep posting
// on the old interval. The upsert re-creates row 1, and reading the row
// back means a save that changed nothing raises an error instead of
// pretending.
export async function saveTelegramAutoPostSettings(
  settings: Pick<
    TelegramAutoPostSettings,
    'enabled' | 'interval_minutes' | 'shows_per_run' | 'selection_mode'
  >,
): Promise<TelegramAutoPostSettings> {
  const { selection_mode, ...rest } = settings;
  const legacy = selectionModeSupported === false;
  const row = {
    id: 1,
    ...rest,
    ...(legacy ? {} : { selection_mode }),
    updated_at: new Date().toISOString(),
  };
  const upsert = supabase.from('telegram_auto_post_settings').upsert(row, { onConflict: 'id' });
  const { data, error } = legacy
    ? await upsert.select(SETTINGS_COLUMNS).maybeSingle()
    : await upsert.select(SETTINGS_COLUMNS_WITH_MODE).maybeSingle();
  if (error) {
    // The column can disappear from under us between load and save only if
    // the probe above never ran (a save on a stale page); retry once
    // without it rather than losing the admin's edit.
    if (isMissingColumn(error)) {
      selectionModeSupported = false;
      return saveTelegramAutoPostSettings(settings);
    }
    throw new Error(describeAutoPostError(error));
  }
  if (!data) {
    throw new Error(
      'Settings were not saved (no row came back). Re-run database/telegram-auto-post-addition.sql so the admin write policies exist.',
    );
  }
  const saved = data as Partial<TelegramAutoPostSettings>;
  return { ...TELEGRAM_AUTO_POST_DEFAULTS, ...saved, selection_mode: saved.selection_mode ?? 'rotate' };
}

export interface TelegramAutoPostLogEntry {
  id: string;
  show_id: string;
  show_title: string;
  posted_at: string;
}

// The last handful of titles the bot actually sent, newest first — the
// panel shows it so "is this thing running?" can be answered without
// opening the group or the edge function logs.
export async function fetchRecentTelegramAutoPosts(limit = 10): Promise<TelegramAutoPostLogEntry[]> {
  const { data, error } = await supabase
    .from('telegram_auto_post_log')
    .select('id, show_id, posted_at, shows(title)')
    .order('posted_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(describeAutoPostError(error));
  type Row = {
    id: string;
    show_id: string;
    posted_at: string;
    // PostgREST types an embedded one-to-one as an array; at runtime it is
    // the single joined row (or null when the show was deleted).
    shows: { title: string } | { title: string }[] | null;
  };
  return ((data ?? []) as Row[]).map((row) => {
    const show = Array.isArray(row.shows) ? row.shows[0] : row.shows;
    return {
      id: row.id,
      show_id: row.show_id,
      show_title: show?.title ?? 'Deleted show',
      posted_at: row.posted_at,
    };
  });
}

export interface AutoPostQueueShow {
  id: string;
  title: string;
  poster_url: string | null;
  coming_soon: boolean;
}

// Every show the admin can pick from, newest first — the panel shows
// this list next to the queue so a title can be added without leaving
// the panel.
export async function fetchAutoPostShowOptions(): Promise<AutoPostQueueShow[]> {
  const { data, error } = await supabase
    .from('shows')
    .select('id, title, poster_url, coming_soon')
    .order('created_at', { ascending: false });
  if (error) throw new Error(describeAutoPostError(error));
  return (data ?? []) as AutoPostQueueShow[];
}

// The admin's chosen posting order, first out first.
export async function fetchAutoPostQueue(): Promise<string[]> {
  const { data, error } = await supabase
    .from('telegram_auto_post_queue')
    .select('show_id, position')
    .order('position', { ascending: true });
  if (error) {
    // Same story as selection_mode: an install that predates the queue
    // simply has no queue, which is an empty list, not a failure.
    if (isMissingTable(error)) {
      selectionModeSupported = false;
      return [];
    }
    throw new Error(describeAutoPostError(error));
  }
  return (data ?? []).map((row) => row.show_id as string);
}

// The whole list is rewritten on every save: positions are the list
// index, so reordering never has to renumber anything by hand. Deleting
// first means a show dropped from the list actually leaves the queue.
export async function saveAutoPostQueue(showIds: string[]): Promise<void> {
  const { error: deleteError } = await supabase
    .from('telegram_auto_post_queue')
    .delete()
    .not('show_id', 'is', null);
  if (deleteError) throw new Error(describeAutoPostError(deleteError));
  if (showIds.length === 0) return;
  const { error } = await supabase
    .from('telegram_auto_post_queue')
    .insert(showIds.map((show_id, index) => ({ show_id, position: index })));
  if (error) throw new Error(describeAutoPostError(error));
}

// When the next scheduled post is due, given the last run and the
// interval — null when it has never run (the next cron tick posts) or
// when auto-posting is off.
export function nextAutoPostDueAt(settings: TelegramAutoPostSettings): Date | null {
  if (!settings.enabled || !settings.last_run_at) return null;
  return new Date(new Date(settings.last_run_at).getTime() + settings.interval_minutes * 60_000);
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

// Explicit columns, never `*`: after
// database/protect-episode-video-url.sql the anon role has no SELECT on
// `video_url`, and PostgREST rejects the whole query — `*` included — if
// it touches a column the role cannot read.
const EPISODE_COLUMNS =
  'id, show_id, episode_number, season, title, description, thumbnail_url, duration, is_free_preview, created_at';

// Before that file is run the URL is still readable, and the player uses
// it as a fallback while the episode-stream function is being deployed.
// One probe decides which of the two shapes this project is on, so the
// catalog loads either way and the fallback disappears by itself the
// moment the column is locked down.
let episodeVideoUrlReadable: boolean | null = null;

export async function fetchEpisodesByShow(showId: string): Promise<Episode[]> {
  const query = (columns: string) =>
    supabase
      .from('episodes')
      .select(columns)
      .eq('show_id', showId)
      .order('season', { ascending: true })
      .order('episode_number', { ascending: true });

  if (episodeVideoUrlReadable !== false) {
    const { data, error } = await query(`${EPISODE_COLUMNS}, video_url`);
    if (!error) {
      episodeVideoUrlReadable = true;
      return (data ?? []) as unknown as Episode[];
    }
    // 42501 = permission denied for the column; anything else is a real
    // failure worth surfacing.
    if (error.code !== '42501' && !/permission denied/i.test(error.message)) throw error;
    episodeVideoUrlReadable = false;
  }

  const { data, error } = await query(EPISODE_COLUMNS);
  if (error) throw error;
  return (data ?? []) as unknown as Episode[];
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
