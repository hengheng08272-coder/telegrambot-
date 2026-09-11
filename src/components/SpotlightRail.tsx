import { useCallback, useRef, useState } from 'react';
import { Play, Clock, Crown } from 'lucide-react';
import type { Show } from '@/lib/types';
import Badge from '@/components/Badge';
import { MOVIE_PRICE } from '@/lib/moviePurchase';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface Props {
  shows: Show[];
  onSelectShow: (show: Show) => void;
}

/**
 * The wide format, for the handful of titles a row is willing to spend
 * real height on.
 *
 * A rail of 112px portrait covers is built to get through a lot of
 * catalog quickly; it is the wrong shape for the one or two things the
 * page is actually pitching. This is the other end of that trade — one
 * 16:9 frame at full width, a play control dead centre, and the price or
 * access state in the corner, swiped one at a time with dots underneath
 * saying how many more there are.
 *
 * No title is drawn over the art. Every poster and banner in this
 * catalog arrives with its title already lettered into the image, so a
 * caption would be printing the same words a second time on top of the
 * artwork it is sitting on.
 */
export default function SpotlightRail({ shows, onSelectShow }: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // Which frame is centred, read off the scroller rather than tracked as
  // its own state machine: the scroll IS the source of truth here.
  // Measured from the children's own offsets rather than by dividing by
  // the item width — the frames sit in a gapped flex row, so each one
  // advances by its width PLUS the gap and index-by-division drifts a
  // frame out by the end of a long row.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i] as HTMLElement;
      const gap = Math.abs(child.offsetLeft + child.offsetWidth / 2 - mid);
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
    if (el && child) {
      el.scrollTo({
        left: child.offsetLeft - (el.clientWidth - child.offsetWidth) / 2,
        behavior: 'smooth',
      });
    }
  };

  if (shows.length === 0) return null;

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto"
      >
        {shows.map((show) => {
          const art = show.banner_url ?? show.poster_url ?? '';
          return (
            <div key={show.id} className="w-full shrink-0 snap-center">
              <button
                onClick={() => onSelectShow(show)}
                aria-label={show.title}
                className="relative block w-full overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
              >
                <div className="aspect-[16/9] w-full bg-[#171114]">
                  {art && (
                    <img
                      src={art}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      // object-top, not centre: a banner is often a
                      // portrait poster pressed into a 16:9 frame, and
                      // faces sit in the upper half of those.
                      className="h-full w-full object-cover object-top"
                    />
                  )}
                </div>

                {/* Just enough scrim at the edges to keep the controls
                    legible over a bright frame, without flattening the
                    artwork the way a full wash does. */}
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(11,8,9,0.34) 0%, rgba(11,8,9,0) 34%, rgba(11,8,9,0) 66%, rgba(11,8,9,0.42) 100%)',
                  }}
                />

                {/* The one control. Ringed rather than filled so it reads
                    as "play this" without covering the frame behind it. */}
                <span
                  aria-hidden
                  className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/95 bg-black/25 backdrop-blur-[2px]"
                >
                  <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
                </span>

                <span className="absolute right-3 top-3">
                  {show.coming_soon ? (
                    <Badge tone="mark" onArt icon={<Clock className="h-3 w-3" />}>
                      {t.comingSoonLabel}
                    </Badge>
                  ) : show.type === 'movie' && !show.is_free ? (
                    <span className="text-[22px] font-black leading-none tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]">
                      ${MOVIE_PRICE}
                    </span>
                  ) : show.is_free ? (
                    <Badge tone="free" onArt>
                      {t.freeBadge}
                    </Badge>
                  ) : (
                    <Badge tone="vip" onArt icon={<Crown className="h-3 w-3" />}>
                      {t.vipBadge}
                    </Badge>
                  )}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Dots — skipped for a single frame, where there is nothing to say
          about position. The active one stretches into a bar instead of
          only changing colour, so it survives a glance at arm's length. */}
      {shows.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {shows.map((show, i) => (
            <button
              key={show.id}
              onClick={() => goTo(i)}
              aria-label={`${i + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === active ? 'w-5 bg-[#4E86FF]' : 'w-1.5 bg-white/25'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
