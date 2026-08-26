import { Film, Play, Star } from 'lucide-react';
import type { Show } from '@/lib/types';
import { MOVIE_PRICE } from '@/lib/moviePurchase';
import Badge from '@/components/Badge';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface Props {
  show: Show;
  onClick: (show: Show) => void;
  /** Hides the price/FREE badge — used on the home screen row, which
   *  already states the $ price once in the row's own header instead of
   *  repeating it on every card. The "View All → Movies" grid has no
   *  such header, so it keeps the badge on each card there. */
  hidePrice?: boolean;
}

/**
 * A movie, given the room a movie deserves.
 *
 * There are only ever a handful of standalone films next to hundreds of
 * series episodes, so they were losing badly in a grid built for poster
 * thumbnails: three tiny covers per row, no way to tell a one-off film
 * from episode one of something, and no sign of the thing that actually
 * makes them an easy yes — they cost a dollar, once, with no membership.
 *
 * This card says all of that at a glance. The background is the film's
 * own artwork, blurred behind the sharp poster, so every card looks
 * different without a single new asset being uploaded — which matters
 * when the shelf is short enough that repetition would be obvious.
 */
export default function MovieCard({ show, onClick, hidePrice }: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const art = show.poster_url ?? show.banner_url ?? '';

  return (
    <button
      onClick={() => onClick(show)}
      className="group relative w-full overflow-hidden rounded-2xl border border-white/10 text-left transition active:scale-[0.99] hover:border-white/20"
    >
      {/* The film's own art, blurred, as the card's ground. */}
      <span aria-hidden className="absolute inset-0">
        {art && (
          <img
            src={art}
            alt=""
            className="h-full w-full scale-125 object-cover opacity-40 blur-xl"
            draggable={false}
          />
        )}
        <span
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(115deg, rgba(10,10,13,0.94) 20%, rgba(10,10,13,0.66) 62%, rgba(32,80,216,0.20) 100%)',
          }}
        />
      </span>

      <span className="relative flex items-stretch gap-3 p-3">
        <span className="relative shrink-0 overflow-hidden rounded-xl shadow-[0_10px_26px_rgba(0,0,0,0.6)]">
          {art ? (
            <img
              src={art}
              alt={show.title}
              className="h-[112px] w-[76px] object-cover transition duration-500 group-hover:scale-105"
              draggable={false}
            />
          ) : (
            <span className="flex h-[112px] w-[76px] items-center justify-center bg-white/5">
              <Film className="h-5 w-5 text-white/40" />
            </span>
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <span className="min-w-0">
            {/* What it is: one film, start to finish. The single fact
                that separates these from every other cover in the app. */}
            <Badge tone="info" onArt icon={<Film className="h-3 w-3" />}>
              {t.movieOneOff}
            </Badge>
            <span className="mt-1.5 block truncate text-[13px] font-bold leading-snug text-white">
              {show.title}
            </span>
            <span className="mt-1 flex items-center gap-2 text-[11px] text-white/50">
              <span className="flex items-center gap-1 text-[#F5C563]">
                <Star className="h-2.5 w-2.5 fill-[#F5C563]" />
                {Number(show.rating).toFixed(1)}
              </span>
              {show.release_year && (
                <>
                  <span className="h-2.5 w-px bg-white/20" aria-hidden />
                  <span className="tabular-nums">{show.release_year}</span>
                </>
              )}
            </span>
          </span>

          {/* Price, or the fact that there isn't one — skipped entirely
              when hidePrice is set. */}
          <span className="mt-2 flex items-center justify-between gap-2">
            {hidePrice ? (
              <span aria-hidden />
            ) : show.is_free ? (
              <Badge tone="free" className="px-2 py-1 text-[11px]">
                {t.freeBadge}
              </Badge>
            ) : (
              <Badge tone="price" className="px-2 py-1 text-[11px]">
                {t.movieOnlyPrice.replace('{price}', `$${MOVIE_PRICE}`)}
              </Badge>
            )}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition group-hover:bg-white/20">
              <Play className="h-3 w-3 fill-white" />
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
