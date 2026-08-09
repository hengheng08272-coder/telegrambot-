import type { Show, Episode } from '@/lib/types';

const WANT_KEY = 'nint-watchlist';
const CONTINUE_KEY = 'nint-continue';

export interface ContinueItem {
  show: Show;
  episode: Episode;
  episodeIndex: number;
  updatedAt: number;
}

function read<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, items: T[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(items));
}

export function getWatchlist(): Show[] {
  return read<Show>(WANT_KEY);
}

export function isInWatchlist(showId: string): boolean {
  return read<Show>(WANT_KEY).some((s) => s.id === showId);
}

export function addToWatchlist(show: Show) {
  const items = read<Show>(WANT_KEY);
  if (items.some((s) => s.id === show.id)) return;
  write(WANT_KEY, [...items, show]);
}

export function removeFromWatchlist(showId: string) {
  write(
    WANT_KEY,
    read<Show>(WANT_KEY).filter((s) => s.id !== showId),
  );
}

export function toggleWatchlist(show: Show): boolean {
  if (isInWatchlist(show.id)) {
    removeFromWatchlist(show.id);
    return false;
  }
  addToWatchlist(show);
  return true;
}

export function getContinueWatching(): ContinueItem[] {
  return read<ContinueItem>(CONTINUE_KEY).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function addToContinueWatching(
  show: Show,
  episode: Episode,
  episodeIndex: number,
) {
  const items = read<ContinueItem>(CONTINUE_KEY);
  const filtered = items.filter((i) => i.show.id !== show.id);
  write(CONTINUE_KEY, [
    { show, episode, episodeIndex, updatedAt: Date.now() },
    ...filtered,
  ]);
}

export function clearContinueWatching(showId: string) {
  write(
    CONTINUE_KEY,
    read<ContinueItem>(CONTINUE_KEY).filter((i) => i.show.id !== showId),
  );
}
