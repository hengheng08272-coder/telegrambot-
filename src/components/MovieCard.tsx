import { Film, Play, Star } from 'lucide-react';
import type { Show } from '@/lib/types';
import { MOVIE_PRICE } from '@/lib/moviePurchase';
import Badge from '@/components/Badge';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import { ROW_ACCENT, tint } from '@/lib/rowAccent';

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
 * v31 — this used to be a small horizontal strip: a 76×112 poster
 * thumbnail beside a column of text, with the film's own art blurred
 * behind it. Two things were wrong with that.
 *
 * The first was resolution. 76×112 CSS pixels is a thumbnail, and on a
 * phone at 3× device pixel ratio the browser only ever needed ~228×336
 * real pixels to draw it — so the card could never look sharp no matter
 * how good the artwork was. Meanwhile every film in the catalogue already
 * has a proper 16:9 banner (1280×720 on the current featured title), and
 * that asset was being used only as a blurred smudge in the background.
 * So the banner is now the card: full-bleed, at the aspect ratio it was
 * authored in, roughly four times the drawn area it had before.
 *
 * The second was motion. The card scaled down on tap and its poster grew
 * on hover, which on a phone reads as the card wobbling under the thumb
 * at the exact moment the viewer is trying to hit it. Nothing here moves
 * now: the pressed state is a brightness change, which reports the tap
 * without shifting a single pixel.
 *
 * Colour comes from access, not decoration. A film you can watch free
 * takes the green accent used by the free rail; a film that costs a
 * dollar takes the blue that means "tappable" everywhere else in the
 * app. One ring, one glow, one badge — all the same hue — so the card's
 * colour states what the card costs.
 */
export default function MovieCard({ show, onClick, hidePrice }: Props) {
  const { lang } = useLang();
  const t = appText[lang];

  // The banner is the point of this card, so it leads. The poster is the
  // fallback and gets cropped to 16:9 by object-cover — worse framing,
  // but a card is better than a hole. 42 of 46 shows have a banner.
  const art = show.banner_url ?? show.poster_url ?? '';
  const accent = show.is_free ? ROW_ACCENT.free : ROW_ACCENT.guide;

  return (
    <button
      onClick={() => onClick(show)}
      className="group relative block w-full overflow-hidden rounded-2xl text-left transition-[filter] duration-150 active:brightness-125"
      style={{
        // One combined shadow: the accent hairline ring, a soft accent
        // bloom below it, and the drop shadow that lifts the card off
        // the page. Written as box-shadow rather than a border so the
        // ring sits outside the 16:9 box and never eats into the art.
        boxShadow: `0 0 0 1px ${tint(accent, 0.35)}, 0 14px 34px -14px ${tint(accent, 0.45)}, 0 10px 30px rgba(0,0,0,0.55)`,
      }}
    >
      <span className="relative block aspect-[16/9] w-full overflow-hidden bg-[#0B1020]">
        {art ? (
          <img
            src={art}
            alt={show.title}
            // A featured movie card is wide — it spans the whole content
            // column — so on a 3× phone it is one of the largest images
            // on the home screen. It is also above the fold in the
            // movies section, so it decodes eagerly rather than lazily.
            decoding="async"
            width={1920}
            height={1080}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <Film className="h-8 w-8 text-white/25" />
          </span>
        )}

        {/* Reading scrim. Steep at the bottom where the title sits,
            almost clear across the top two thirds so the artwork is the
            thing the eye lands on first. */}
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(8,12,22,0.55) 0%, rgba(8,12,22,0.08) 30%, rgba(8,12,22,0.62) 72%, rgba(8,12,22,0.95) 100%)',
          }}
        />

        {/* What it is: one film, start to finish. The single fact that
            separates these from every other cover in the app. */}
        <span className="absolute left-2.5 top-2.5">
          <Badge tone="info" onArt icon={<Film className="h-3 w-3" />}>
            {t.movieOneOff}
          </Badge>
        </span>

        {/* Price, or the fact that there isn't one — skipped entirely
            when hidePrice is set. The tilted ink-stamp treatment is
            gone: at this size it was the loudest thing on the card, and
            it sat where the artwork wanted to be. A plain pill in the
            corner says the same number and lets the film be the image. */}
        {!hidePrice && (
          <span className="absolute right-2.5 top-2.5">
            {show.is_free ? (
              <Badge tone="free" onArt>
                {t.freeBadge}
              </Badge>
            ) : (
              <Badge tone="price" onArt className="whitespace-nowrap">
                {t.movieOnlyPrice.replace('{price}', `$${MOVIE_PRICE}`)}
              </Badge>
            )}
          </span>
        )}

        {/* Title block, sitting on the steep end of the scrim. */}
        <span className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-3 sm:p-3.5">
          <span className="min-w-0 flex-1">
            <span
              className="block text-[15px] font-black leading-[1.15] text-white sm:text-lg"
              style={{
                fontFamily: '"Anton", Battambang, Inter, sans-serif',
                letterSpacing: '0.01em',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textShadow: '0 2px 12px rgba(0,0,0,0.85)',
              }}
            >
              {show.title}
            </span>
            <span className="mt-1 flex items-center gap-2 text-[11px] font-semibold text-white/70 sm:text-xs">
              <span className="flex items-center gap-1 text-[#F5C563]">
                <Star className="h-2.5 w-2.5 fill-[#F5C563] sm:h-3 sm:w-3" />
                {Number(show.rating).toFixed(1)}
              </span>
              {show.release_year && (
                <>
                  <span className="h-3 w-px bg-white/25" aria-hidden />
                  <span className="tabular-nums">{show.release_year}</span>
                </>
              )}
            </span>
          </span>

          {/* The one affordance. Filled in the access accent, so a free
              film's button is green and a paid one's is blue — the same
              hue as this card's ring and its price badge. The glyph
              flips to deep navy on the green fill: white on #2FD98C is
              under 2:1 contrast and the arrow disappears. */}
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11"
            style={{
              background: accent,
              color: show.is_free ? '#08111F' : '#FFFFFF',
              boxShadow: `0 6px 18px ${tint(accent, 0.45)}`,
            }}
          >
            <Play className="h-4 w-4 fill-current sm:h-[18px] sm:w-[18px]" />
          </span>
        </span>
      </span>
    </button>
  );
}
