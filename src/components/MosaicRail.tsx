import { useCallback, useRef, useState } from 'react';
import type { Show } from '@/lib/types';
import Badge from '@/components/Badge';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

/**
 * The mosaic rails — the "free style" layout from the 4A handoff.
 *
 * Every other rail in this app is a row of identical 2:3 covers. That
 * shape is built to get through a lot of catalog quickly, and it makes
 * one row look exactly like the next one. The mosaic does the opposite:
 * a title is shown as TWO images butted together across a 3px gutter —
 * the tall 2:3 poster plus a short 16:9 crop of the same show — so the
 * row reads as a pasted-up wall rather than a tray of matching cards.
 *
 * Three rules hold across everything in here, and they are the whole
 * look: corners are 3px, gaps between joined images are 3px, and joined
 * images carry no ring. A 12px radius or a hairline ring anywhere in
 * this layout immediately reads as a separate card again, which is the
 * one thing the mosaic is built to avoid.
 */

/** The mosaic's two numbers, named once so a stray 4px cannot creep in. */
const R = 3;
const GUTTER = 3;

/** Corner sets for an image that is one tile of a joined strip: round
 *  only the outside edges, leave the joined edge square. */
const capLeft = `${R}px 0 0 ${R}px`;
const capRight = `0 ${R}px ${R}px 0`;

interface TrendingProps {
  shows: Show[];
  onSelectShow: (s: Show) => void;
  /** show id -> newest episode number, for the caption's meta line. */
  episodeNumbers?: Record<string, number>;
  /** Ranks the first N items (`TOP 1`, `TOP 2`, …) on the poster. */
  ranked?: boolean;
}

/**
 * Trending — one title per mosaic pair, captioned underneath.
 */
export function MosaicTrendingRail({ shows, onSelectShow, episodeNumbers, ranked }: TrendingProps) {
  const { lang } = useLang();
  const t = appText[lang];
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // Which pair the row is parked on, read off the scroller's left edge —
  // the pairs snap to start, so the leading edge is the honest answer.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i] as HTMLElement;
      const gap = Math.abs(child.offsetLeft - el.offsetLeft - el.scrollLeft);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    setActive((prev) => (prev === best ? prev : best));
  }, []);

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    const child = el?.children[i] as HTMLElement | undefined;
    if (el && child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  };

  if (shows.length === 0) return null;

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="rail-scroller no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8"
      >
        {shows.map((show, i) => {
          const poster = show.poster_url ?? show.banner_url ?? '';
          // The wide tile prefers a real banner and falls back to the
          // poster. A 2:3 poster squeezed into a square crop is not
          // flattering, so the fallback is anchored to the top of the
          // frame where the faces in this catalog's art sit.
          const wide = show.banner_url ?? show.poster_url ?? '';
          const ep = episodeNumbers?.[show.id];
          return (
            <button
              key={show.id}
              onClick={() => onSelectShow(show)}
              className="mosaic-press w-full max-w-[358px] shrink-0 snap-start text-left"
            >
              {/* 5:3 is what the two shapes add up to. The poster is 2:3
                  and the crop is square, both the same height H, so the
                  pair is H*2/3 + H wide — five thirds of its own height.
                  Stating it as one aspect ratio lets the whole pair scale
                  with the screen instead of being pinned to the handoff's
                  phone pixels.

                  The 358px cap is what keeps that from running away: a
                  pair that is simply "full width" is 358px on a phone,
                  which is the intended one-per-screen, but 1400px in a
                  desktop window — and at 5:3 that is an 840px-tall row
                  filling the entire page. Capped, the phone is unchanged
                  and a wide window just shows several pairs. */}
              <span className="flex w-full" style={{ aspectRatio: '5 / 3', gap: GUTTER }}>
                <span
                  className="relative block h-full shrink-0 overflow-hidden bg-[#141416]"
                  style={{ width: `calc(40% - ${GUTTER / 2}px)`, borderRadius: capLeft }}
                >
                  {poster && (
                    <img
                      src={poster}
                      alt=""
                      loading={i === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      width={600}
                      height={900}
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  )}
                  {ranked && (
                    <span className="absolute left-[5px] top-[5px]">
                      <Badge tone="mark" onArt square>
                        TOP {i + 1}
                      </Badge>
                    </span>
                  )}
                </span>
                <span
                  className="relative block h-full flex-1 overflow-hidden bg-[#141416]"
                  style={{ borderRadius: capRight }}
                >
                  {wide && (
                    <img
                      src={wide}
                      alt=""
                      loading={i === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      width={1600}
                      height={900}
                      draggable={false}
                      className="h-full w-full object-cover object-top"
                    />
                  )}
                </span>
              </span>
              <span className="mt-2 block">
                <span className="line-clamp-1 text-[13px] font-semibold leading-[1.3] text-white/95">
                  {show.title}
                </span>
                {!!ep && show.type !== 'movie' && (
                  <span className="mt-1 block text-[11px] font-bold text-white/40">
                    {t.epShort} {ep}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Dots. With one pair filling the screen there is nothing sticking
          out past the edge to hint that the row continues, so this is the
          only thing saying so. */}
      {shows.length > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {shows.map((show, i) => (
            <button
              key={show.id}
              onClick={() => goTo(i)}
              aria-label={show.title}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? 'w-5 bg-[#FF6B60]' : 'w-1.5 bg-white/25'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface StripProps {
  shows: Show[];
  onSelectShow: (s: Show) => void;
  /** show id -> season number of the paid season this free one runs
   *  into. The handoff's free tile has no slot for this, but it is the
   *  reason the free row exists: without it a viewer finds out the story
   *  continues behind the paywall only after the last free episode. */
  continuesAt?: Record<string, number>;
}

/**
 * The free strip — one wide tile then two narrow ones, butted together.
 *
 * The handoff draws exactly three tiles. A catalog has however many free
 * titles it has, so this repeats that unit: every group of three starts
 * with the wide tile (which is the only one that carries a visible
 * title) and is followed by two narrow ones. The group, not the tile, is
 * what the rail scrolls past.
 */
export function MosaicFreeStrip({ shows, onSelectShow, continuesAt }: StripProps) {
  const { lang } = useLang();
  const t = appText[lang];

  if (shows.length === 0) return null;

  const groups: Show[][] = [];
  for (let i = 0; i < shows.length; i += 3) groups.push(shows.slice(i, i + 3));

  return (
    <div className="rail-scroller no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
      {groups.map((group) => (
        <span key={group[0].id} className="flex shrink-0" style={{ gap: GUTTER }}>
          {group.map((show, i) => {
            const lead = i === 0;
            const art = lead
              ? (show.banner_url ?? show.poster_url ?? '')
              : (show.poster_url ?? show.banner_url ?? '');
            // Only the outermost tiles of a group round their outer
            // corners; a tile in the middle of the strip stays square on
            // both sides so the group reads as one pasted block.
            const radius = lead
              ? capLeft
              : i === group.length - 1
                ? capRight
                : '0';
            return (
              <button
                key={show.id}
                onClick={() => onSelectShow(show)}
                aria-label={show.title}
                className="mosaic-press relative block shrink-0 overflow-hidden bg-[#141416]"
                style={{ width: lead ? 178 : 66, height: 96, borderRadius: radius }}
              >
                {art && (
                  <img
                    src={art}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="h-full w-full object-cover object-top"
                  />
                )}
                {lead && (
                  <>
                    {/* Scrim only under the lead tile, which is the only
                        one with type printed on it. */}
                    <span
                      aria-hidden
                      className="absolute inset-0"
                      style={{
                        background:
                          'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.85) 100%)',
                      }}
                    />
                    <span className="absolute left-[5px] top-[5px] flex gap-1">
                      <Badge tone="free" onArt square>
                        {t.freeBadge}
                      </Badge>
                      {continuesAt?.[show.id] !== undefined && (
                        <Badge tone="vip" onArt square className="whitespace-nowrap">
                          {t.seasonShort}
                          {continuesAt[show.id]}
                        </Badge>
                      )}
                    </span>
                    <span className="absolute bottom-1.5 left-2 right-2 truncate text-left text-[13px] font-semibold text-[#EEF1F8]">
                      {show.title}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </span>
      ))}
    </div>
  );
}
