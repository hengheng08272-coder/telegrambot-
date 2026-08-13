-- Lets the admin mark a show as "Coming Soon" — it has a banner/poster
-- ready to promote (and can appear in the hero carousel) but doesn't have
-- any episodes uploaded yet. The Home screen shows these in their own
-- "Coming Soon" row instead of mixed in with playable content.
alter table public.shows
  add column if not exists coming_soon boolean not null default false;

comment on column public.shows.coming_soon is
  'True when this show is announced/promoted but has no episodes yet — shown in the Coming Soon row instead of the normal rails.';
