import { useRef, useState } from 'react';
import { Play, Clock, Crown } from 'lucide-react';
import type { Show } from '@/lib/types';
import Badge from '@/components/Badge';
import { MOVIE_PRICE } from '@/lib/moviePurchase';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface ShowCardProps {
  show: Show;
  onClick: (show: Show) => void;
  /** Highest published episode number, shown as an "EP n" corner badge —
   *  the thing a returning viewer actually scans a rail for. Omitted for
   *  movies and for shows with no episodes yet, which get no badge. */
  latestEpisode?: number;
  /** 1-based rank — when set, renders a big stroked numeral behind the
   *  bottom-left corner of the poster, Top-10-rail style. */
  rank?: number;
  /** Bigger poster + deeper drop shadow — used for the Top 10 rail so it
   *  reads with the same weight as the hero banner above it. */
  large?: boolean;
}

export default function ShowCard({ show, onClick, latestEpisode, rank, large }: ShowCardProps) {
  const [loaded, setLoaded] = useState(false);
  const tiltRef = useRef<HTMLDivElement>(null);
  const { lang } = useLang();
  const t = appText[lang];

  // Added within the last week — a plain fact read off created_at, not an
  // admin toggle, so it clears on its own instead of needing to be turned
  // off by hand once a title stops being new.
  const isNew =
    !!show.created_at && Date.now() - new Date(show.created_at).getTime() < 7 * 24 * 60 * 60 * 1000;

  // Subtle pointer-driven 3D tilt — works for mouse hover and for a
  // finger resting/dragging on the card (Pointer Events unify both).
  // Mutates the DOM node directly instead of going through React state so
  // it stays smooth at 60fps even while scrolling a rail full of these.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = tiltRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${(-py * 12).toFixed(2)}deg) rotateY(${(px * 12).toFixed(2)}deg)`;
  };
  const resetTilt = () => {
    const el = tiltRef.current;
    if (el) el.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg)';
  };

  return (
    <button
      onClick={() => onClick(show)}
      className={`group relative shrink-0 text-left ${
        large ? 'w-[128px] sm:w-[164px]' : rank ? 'w-[122px] sm:w-[160px]' : 'w-[104px] sm:w-[124px]'
      } ${rank ? 'pl-8 sm:pl-10' : ''}`}
    >
      {rank && (
        <span
          aria-hidden
          className="pointer-events-none absolute -left-3 bottom-0 z-0 select-none sm:-left-4"
          style={{
            fontSize: 'clamp(100px, 32vw, 168px)',
            fontWeight: 900,
            lineHeight: 1,
            color: 'rgba(10,16,30,0.5)',
            WebkitTextStroke: '2.5px rgba(255,255,255,0.9)',
            fontFamily: '"Anton", Battambang, Inter, sans-serif',
            filter:
              'drop-shadow(0 2px 0 rgba(76,111,255,0.3)) drop-shadow(0 14px 22px rgba(0,0,0,0.9)) drop-shadow(0 0 18px rgba(76,111,255,0.2))',
          }}
        >
          {rank}
        </span>
      )}
      <div
        ref={tiltRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={resetTilt}
        onPointerUp={resetTilt}
        onPointerCancel={resetTilt}
        className="relative z-10"
        style={{ transition: 'transform 0.35s ease-out', transform: 'perspective(700px) rotateX(0deg) rotateY(0deg)' }}
      >
        <div
          className={`aspect-[2/3] overflow-hidden rounded-[10px] bg-[#151926] ring-1 ring-white/[0.09] transition duration-300 ease-out group-hover:z-20 group-hover:-translate-y-2 group-hover:scale-[1.04] group-hover:ring-2 group-hover:ring-[#2050D8]/60 ${
            large
              ? 'shadow-[0_18px_46px_rgba(0,0,0,0.7)] group-hover:shadow-[0_28px_60px_rgba(0,0,0,0.8)]'
              : 'shadow-[0_6px_18px_rgba(0,0,0,0.5)] group-hover:shadow-[0_20px_44px_rgba(0,0,0,0.7)]'
          }`}
        >
          {!loaded && <div className="absolute inset-0 skeleton-shimmer bg-[#151926]" />}
          <img
            src={show.poster_url ?? ''}
            alt={show.title}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 ${
              loaded ? 'img-fade loaded' : 'img-fade'
            }`}
          />
          {/* Bottom gradient — taller for ranked cards since it also has
              to carry the title text now sitting on the poster itself. */}
          <div
            className="absolute inset-0"
            style={{
              background: rank
                ? 'linear-gradient(180deg, rgba(10,16,30,0) 35%, rgba(10,16,30,0.95) 100%)'
                : 'linear-gradient(180deg, rgba(10,16,30,0) 50%, rgba(10,16,30,0.9) 100%)',
            }}
          />
          {/* Title — overlaid directly on the poster for ranked (Top 10)
              cards so the row reads as pure artwork instead of poster +
              caption; other rows keep the plain caption below the card.
              Single-line with an ellipsis when it's too long to fit, gold
              by default (not just on hover) to match the numeral behind
              it. */}
          {rank && (
            <div className="absolute inset-x-0 bottom-0 z-[1] p-2.5">
              <h3 className="truncate text-[13px] font-bold leading-tight text-[#FFE7B0] drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] sm:text-[13px]">
                {show.title}
              </h3>
            </div>
          )}
          {/* View-count badge — real play counts (see increment_show_view_count),
              not an admin-typed rating, so this is what actually drives
              Top 10 and shows the owner which titles viewers watch most. */}
          {show.type !== 'movie' && !!latestEpisode && (
            <Badge tone="info" onArt className={`absolute left-1.5 z-[2] ${rank ? 'bottom-9' : 'bottom-1.5'}`}>
              EP {latestEpisode}
            </Badge>
          )}
          {/* A standalone film's price, where a series shows its latest
              episode number. Both answer the same question in a rail —
              "what do I get if I tap this" — and a movie's answer is a
              dollar, once, with no membership involved. */}
          {show.type === 'movie' && !show.is_free && !show.coming_soon && (
            <Badge tone="price" onArt className="absolute bottom-1.5 left-1.5">
              ${MOVIE_PRICE}
            </Badge>
          )}
          {/* Coming Soon marker — announced/promoted but no episodes yet
              (admin toggle). Icon-only since the row header above already
              says "Coming Soon" in words. */}
          {show.coming_soon && (
            <Badge tone="mark" onArt icon={<Clock className="h-3 w-3" />} className="absolute right-1.5 top-1.5">
              {t.comingSoonLabel}
            </Badge>
          )}
          {/* NEW marker — added within the last 7 days. Skipped on Coming
              Soon cards since that badge already owns the top-right
              corner and says something more specific. */}
          {!show.coming_soon && isNew && (
            <Badge tone="mark" onArt className="absolute right-1.5 top-1.5">
              {t.newTag ?? 'NEW'}
            </Badge>
          )}
          {/* FREE / VIP badge — same subscription status the detail screen
              and hero cover enforce, so browsing never over-promises what's
              actually playable. Skipped on Coming Soon cards since neither
              label means anything until episodes exist. A standalone movie
              gets its own "One-off movie" label instead of VIP here — it's
              bought once for a flat price, not gated behind a subscription,
              so a VIP crown on it would say the wrong thing even though
              is_free is false. */}
          {!show.coming_soon && show.type === 'movie' && !show.is_free && (
            <Badge tone="info" onArt className="absolute left-1.5 top-1.5 whitespace-nowrap">
              {t.movieOneOff}
            </Badge>
          )}
          {!show.coming_soon && show.type !== 'movie' && (
            <Badge
              tone={show.is_free ? 'free' : 'vip'}
              onArt
              icon={show.is_free ? undefined : <Crown className="h-3 w-3" />}
              className="absolute left-1.5 top-1.5"
            >
              {show.is_free ? t.freeBadge : t.vipBadge}
            </Badge>
          )}
          {!show.coming_soon && show.type === 'movie' && show.is_free && (
            <Badge tone="free" onArt className="absolute left-1.5 top-1.5">
              {t.freeBadge}
            </Badge>
          )}
          {/* Hover play overlay — omitted for Coming Soon cards, since
              tapping them can't actually play anything yet. */}
          {!show.coming_soon && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition duration-300 group-hover:opacity-100">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-gradient shadow-[0_0_28px_rgba(32,80,216,0.65)]">
                <Play className="h-4 w-4 fill-white text-white" />
              </div>
            </div>
          )}
        </div>
      </div>
      {!rank && (
        <div className="mt-2 px-0.5">
          <h3 className={`truncate font-semibold text-white/95 transition group-hover:text-[#4E86FF] ${large ? 'text-[13.5px]' : 'text-[13px]'}`}>
            {show.title}
          </h3>
        </div>
      )}
    </button>
  );
}
