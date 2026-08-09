export type ShowType = 'series' | 'movie';

export interface Genre {
  id: string;
  name: string;
  slug: string;
}

export interface Show {
  id: string;
  title: string;
  synopsis: string | null;
  poster_url: string | null;
  banner_url: string | null;
  release_year: number | null;
  rating: number;
  status: string | null;
  studio: string | null;
  type: ShowType;
  featured: boolean;
  view_count?: number;
  is_free?: boolean;
  created_at?: string;
  genres?: Genre[];
}

export interface Episode {
  id: string;
  show_id: string;
  episode_number: number;
  season: number;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  duration: number | null;
  is_free_preview?: boolean;
}

export interface ShowWithGenres extends Show {
  genres: Genre[];
}
