#!/usr/bin/env python3
"""
Turn a videourls.csv export from the old system into an idempotent
import script for database/content-import-from-csv.sql.

    python3 tools/csv-to-import-sql.py videourls.csv > database/content-import-from-csv.sql

Re-run this whenever a fresh export lands (new episodes, new shows) and
paste the result into the Supabase SQL Editor. The generated script only
ever adds what is missing, so re-importing a superset of what is already
there is the normal way to use it.

Expected columns: type, show, movieId, episode, title, videoUrl,
gumletPlaybackUrl, videoSources, isPremium.
"""
import csv
import collections
import re
import sys

# Rows whose movieId is listed here are dropped — test/demo content that
# should not reach the app.
SKIP_MOVIE_IDS = {'6a9579ab9e6bd786f7ae8e84'}


def strip_zero_width(text):
    return text.replace('​', '').replace('﻿', '')


def show_title_from_episode(title):
    """Derive a show's name from one of its episode titles.

    The export has no show-name column — `show` holds an id — so the name
    has to come out of titles like "កំណត់ថ្ងៃក្លាយជាអាទិទេព ភាគទី ១".
    Callers take the most common result across a show's episodes, which
    absorbs the one-off typos in the data.
    """
    text = re.sub(r'\s+', ' ', strip_zero_width(title)).strip()

    # Final-episode markers, which only some titles carry: "(ភាគបញ្ចប់)",
    # "ចប់". Looped because a few titles carry more than one.
    for _ in range(3):
        text = re.sub(r'\s*[\(（]\s*ភាគ(?:បញ្ចប់|ចប់)\s*[\)）]\s*$', '', text)
        text = re.sub(r'\s*ភាគ(?:បញ្ចប់|ចប់)\s*$', '', text)
        text = re.sub(r'\s*ចប់\s*$', '', text)

    text = re.sub(r'\s*ភាគទី\s*[០-៩\d]+\s*$', '', text)

    # A few titles end in a bare number instead of "ភាគទី <n>" — but a
    # number following a season word belongs to the show's NAME, and
    # stripping it collapses "លោកប្តីអស្ចារ្យ រដូវកាលទី ២" onto season 1,
    # which then loses every episode of one season to the other's
    # numbering.
    if not re.search(r'(?:រដូវកាលទី|វគ្គ|ភាគទី)\s*[០-៩\d]+\s*$', text):
        text = re.sub(r'\s+[០-៩]+\s*$', '', text)

    return text.strip()


def sql_literal(value):
    if not value:
        return 'null'
    return "'" + value.replace("'", "''") + "'"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)

    with open(sys.argv[1], encoding='utf-8') as handle:
        rows = list(csv.DictReader(handle))

    groups = collections.OrderedDict()
    for row in rows:
        groups.setdefault(row['movieId'], []).append(row)

    shows, episodes = [], []
    for movie_id, group in groups.items():
        if movie_id in SKIP_MOVIE_IDS:
            continue

        titles = collections.Counter(show_title_from_episode(r['title']) for r in group)
        title = titles.most_common(1)[0][0]
        is_movie = (
            any(r['type'] == 'full-movie' for r in group)
            or bool(re.search(r'\(Movie\)\s*$', title))
        )
        shows.append((movie_id, title, 'movie' if is_movie else 'series'))

        for row in group:
            number = int(row['episode']) if row['episode'].strip() else 1
            episodes.append((
                movie_id,
                number,
                strip_zero_width(row['title']).strip(),
                strip_zero_width(row['videoUrl']).strip() or None,
                # isPremium=TRUE meant "VIP only" in the old system, which
                # is the inverse of is_free_preview here.
                row['isPremium'].strip().upper() != 'TRUE',
            ))

    # Two things worth knowing before running the output, so they go in
    # the file's own header rather than only on the terminal.
    missing_url = sum(1 for e in episodes if e[3] is None)
    free = sum(1 for e in episodes if e[4])

    duplicates = [t for t, n in collections.Counter(s[1] for s in shows).items() if n > 1]
    if duplicates:
        print(f'-- WARNING: {len(duplicates)} derived titles collide: {duplicates}',
              file=sys.stderr)

    print(HEADER.format(
        shows=len(shows), episodes=len(episodes),
        missing_url=missing_url, free=free, locked=len(episodes) - free,
    ))

    print('insert into public.shows (source_id, title, type, status, coming_soon, is_free, featured)')
    print('values')
    print(',\n'.join(
        f'  ({sql_literal(m)}, {sql_literal(t)}, {sql_literal(ty)}, '
        "'ongoing', false, false, false)"
        for m, t, ty in shows
    ))
    print('on conflict (source_id) where source_id is not null do nothing;\n')

    print(EPISODES_INTRO)
    print(',\n'.join(
        f'  ({sql_literal(m)}, {n}, {sql_literal(t)}, {sql_literal(u)}, {str(fr).lower()})'
        for m, n, t, u, fr in episodes
    ))
    print(FOOTER)


HEADER = '''/*
# Bulk content import — {shows} shows, {episodes} episodes (addition)

GENERATED FILE — produced by tools/csv-to-import-sql.py from the old
system's videourls.csv export. Regenerate rather than hand-editing.

## Safe to run more than once

A re-run adds only what is missing and touches nothing already there.
Two things make that true:

- `shows.source_id` records the old system's movieId, with a unique
  index on it. That is what identifies a show across runs: the titles
  here are derived from episode names, so matching on title would
  re-create a show the moment someone renamed it in the admin panel.
- `episodes` already has UNIQUE (show_id, episode_number), so a second
  run cannot duplicate an episode.

Both inserts are ON CONFLICT DO NOTHING, so a show renamed or an episode
edited by hand afterwards keeps that version rather than being reset.

## What it deliberately leaves empty

- **poster_url / banner_url stay NULL.** The CSV carries no artwork. Add
  it from Admin -> Shows whenever; a re-run will not overwrite it.
- **duration stays NULL.** Reading metadata off {episodes} remote videos
  would take far longer than the import itself, and the per-episode
  "paste URL" flow fills it in when a link is replaced.
- **synopsis, release_year, studio and genres stay empty** — not in the
  CSV to begin with.

## Notes on the data

- {missing_url} episodes have no video URL in the CSV. They are created anyway,
  with video_url NULL, so the gaps show up in the admin panel instead of
  being silently absent.
- isPremium maps to is_free_preview inverted: isPremium=FALSE meant the
  episode played without paying. {free} episodes arrive unlocked,
  {locked} VIP-locked.
- Season is always 1. Seasons are separate movieIds in this export
  ("... រដូវកាលទី ២" has its own id and becomes its own show), so folding
  them together would need a judgement the CSV cannot support.

Run in the SQL Editor.
*/

-- Identity for re-runs. Nullable, and the unique index is partial, so
-- shows created by hand in the admin panel are entirely unaffected.
alter table public.shows
  add column if not exists source_id text;

create unique index if not exists shows_source_id_key
  on public.shows(source_id) where source_id is not null;

comment on column public.shows.source_id is
  'movieId from the legacy system, set only by CSV import. Lets a re-import match an existing show even after it has been renamed here.';

begin;

-- ---------- shows ----------'''

EPISODES_INTRO = '''-- ---------- episodes ----------
-- Joined through source_id rather than a hardcoded uuid, so this works
-- whether the block above just created the show or an earlier run did.
insert into public.episodes (show_id, episode_number, season, title, video_url, is_free_preview)
select s.id, v.episode_number, 1, v.title, v.video_url, v.is_free_preview
from (values'''

FOOTER = ''') as v(source_id, episode_number, title, video_url, is_free_preview)
join public.shows s on s.source_id = v.source_id
on conflict (show_id, episode_number) do nothing;

commit;

-- ---------- what landed ----------
select s.title, s.type, count(e.id) as episodes,
       count(*) filter (where e.video_url is null) as missing_url,
       count(*) filter (where e.is_free_preview) as free_eps
from public.shows s
left join public.episodes e on e.show_id = s.id
where s.source_id is not null
group by s.id, s.title, s.type
order by s.title;'''


if __name__ == '__main__':
    main()
