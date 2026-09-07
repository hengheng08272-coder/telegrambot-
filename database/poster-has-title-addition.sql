-- Posters that carry the show's name inside the artwork.
--
-- Applied to the live project as migration `add_poster_has_title_to_shows`.
-- Kept here so the schema in this repo matches what is deployed.
--
-- The catalogue is moving to commissioned Khmer key art with the title set
-- into the image itself. On those covers the app's own caption under the
-- card repeats the same words in a worse typeface, truncated, and the
-- Top 10 rail draws a second title straight over the painted one.
--
-- This flag says "the artwork already says what this is", and the card
-- drops its caption instead of saying it twice. Default false, so every
-- existing plain poster keeps the caption it has today.
--
-- Badges are NOT suppressed: they say things the artwork cannot (free vs
-- members, episode count, finished). The poster spec in DESIGN_SYSTEM
-- section 3គ therefore reserves the top 18% and bottom 16% of the image
-- for them and puts the painted title in the 55%-84% band.

alter table public.shows
  add column if not exists poster_has_title boolean not null default false;

comment on column public.shows.poster_has_title is
  'True when the poster artwork already contains the show title, so the UI suppresses its own caption. See ShowCard.';
