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

  if (shows.length === 0) return null;

  return (
    <div className="rail-scroller no-scrollbar -mx-4 flex gap-3.5 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
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
            className="mosaic-press flex shrink-0 flex-col gap-[7px] text-left"
          >
            <span className="flex" style={{ gap: GUTTER }}>
              <span
                className="relative block shrink-0 overflow-hidden bg-[#171114]"
                style={{ width: 92, height: 138, borderRadius: capLeft }}
              >
                {poster && (
                  <img
                    src={poster}
                    alt=""
                    loading="lazy"
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
                className="relative block shrink-0 overflow-hidden bg-[#171114]"
                style={{ width: 138, height: 138, borderRadius: capRight }}
              >
                {wide && (
                  <img
                    src={wide}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={1600}
                    height={900}
                    draggable={false}
                    className="h-full w-full object-cover object-top"
                  />
                )}
              </span>
            </span>
            {/* 233px = 92 + 3 + 138: the caption is exactly as wide as
                the pair above it, so a long title wraps against the
                artwork's own edge instead of pushing the row wider. */}
            <span className="block" style={{ width: 92 + GUTTER + 138 }}>
              <span className="line-clamp-1 text-[13px] font-semibold leading-[1.3] text-white/95">
                {show.title}
              </span>
              {!!ep && show.type !== 'movie' && (
                <span className="ml-1 text-[11px] font-bold text-white/40">
                  · {t.epShort} {ep}
                </span>
              )}
            </span>
          </button>
        );
      })}
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
                className="mosaic-press relative block shrink-0 overflow-hidden bg-[#171114]"
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
                          'linear-gradient(180deg, rgba(11,8,9,0) 45%, rgba(11,8,9,0.85) 100%)',
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
