-- Lets the admin attach a short trailer clip to a show (mainly meant for
-- completed series, but works for any show) — a direct video URL that
-- plays in a small preview player on the show detail screen, separate
-- from the numbered episodes.
--
-- ShowDetailScreen reads shows.trailer_url and, when present, renders a
-- compact trailer player under the show info. AdminScreen's show
-- edit/create form gets a matching "Trailer URL" field to set it.
alter table public.shows
  add column if not exists trailer_url text;

comment on column public.shows.trailer_url is
  'Optional direct URL to a short trailer/preview clip for this show, shown on the show detail screen below the synopsis. Null/empty hides the trailer player.';
