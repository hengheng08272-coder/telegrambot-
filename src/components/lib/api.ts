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
