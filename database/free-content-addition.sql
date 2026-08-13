-- Lets the admin mark a whole show as free-to-watch (no VIP required), and
-- mark individual episodes as free previews. Both default to false, so
-- every show/episode is VIP-locked by default ("auto-lock") the moment it's
-- created — the admin has to explicitly unlock the ones they want open.
--
-- HomeScreen/ShowCard/CoverflowHero already read shows.is_free (FREE badge
-- on posters + hero cover), and ShowDetailScreen already reads
-- episodes.is_free_preview to decide whether an episode plays without a
-- subscription (`locked = !subscribed && !ep.is_free_preview`) — this
-- migration just adds the columns those already expect.
alter table public.shows
  add column if not exists is_free boolean not null default false;

alter table public.episodes
  add column if not exists is_free_preview boolean not null default false;

comment on column public.shows.is_free is
  'True when the whole show is free to watch — no VIP subscription required. Shows a FREE badge instead of the VIP crown.';

comment on column public.episodes.is_free_preview is
  'True when this specific episode plays without a VIP subscription. Defaults to false (locked) — admin unlocks per-episode or in bulk from the Admin Panel.';
