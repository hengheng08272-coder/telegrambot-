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
 * The wide format, two to a screen.
 *
 * A rail of 112px portrait covers is built to get through a lot of
 * catalog quickly; it is the wrong shape for the handful of things the
 * page is actually pitching. This is the other end of that trade — 16:9
 * frames with a play control dead centre and the price in the corner.
 *
 * Two per screen, not one. A single full-width frame filled the row with
 * one film and gave no sense that a second existed without swiping; at
 * half width both fit on a phone at once, which is what makes the row
 * read as a shelf rather than as an advert.
 *
 * The title is captioned underneath rather than printed over the art —
 * a 174px frame has no room to letter a Khmer title across it without
 * covering the thing being sold.
 */
export default function SpotlightRail({ shows, onSelectShow }: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // Which frame leads the view, read off the scroller rather than tracked
  // as its own state machine: the scroll IS the source of truth here.
  //
  // Measured against the scroller's LEFT edge, not its centre. With two
  // frames visible the centre line falls in the gutter between them, so
  // centre-matching flickered between neighbours on the smallest scroll.
  // The frames snap to start, so the leading edge is what the row is
  // actually parked on. Offsets come from the children themselves rather
  // than from dividing by item width — they sit in a gapped flex row, so
  // each advances by its width PLUS the gap.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft;
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i] as HTMLElement;
      const gap = Math.abs(child.offsetLeft - el.offsetLeft - left);
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
      el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: 'smooth' });
    }
  };

  if (shows.length === 0) return null;

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 sm:-mx-8 sm:px-8"
      >
        {shows.map((show) => {
          const art = show.banner_url ?? show.poster_url ?? '';
          return (
            <div key={show.id} className="w-[calc(50%-5px)] shrink-0 snap-start sm:w-[calc(33.333%-7px)]">
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
                  className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/95 bg-black/25 backdrop-blur-[2px]"
                >
                  <Play className="ml-0.5 h-4 w-4 fill-white text-white" />
                </span>

                <span className="absolute left-2 top-2">
                  {show.coming_soon ? (
                    <Badge tone="mark" onArt square icon={<Clock className="h-3 w-3" />}>
                      {t.comingSoonLabel}
                    </Badge>
                  ) : show.type === 'movie' && !show.is_free ? (
                    <Badge tone="price" onArt square>
                      ${MOVIE_PRICE}
                    </Badge>
                  ) : show.is_free ? (
                    <Badge tone="free" onArt square>
                      {t.freeBadge}
                    </Badge>
                  ) : (
                    <Badge tone="vip" onArt square icon={<Crown className="h-3 w-3" />}>
                      {t.vipBadge}
                    </Badge>
                  )}
                </span>
              </button>
              <p className="mt-2 truncate text-[12px] font-semibold leading-none text-white/95">
                {show.title}
              </p>
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
