import { useEffect, useRef, useState } from 'react';
import { Play, Clock, Crown } from 'lucide-react';
import type { Show } from '@/lib/types';
import Badge from '@/components/Badge';
import { MOVIE_PRICE } from '@/lib/moviePurchase';
import { useLang } from '@/lib/useLang';
import { parseSeason } from '@/lib/seasons';
import { appText } from '@/lib/appTranslations';

interface ShowCardProps {
  show: Show;
  onClick: (show: Show) => void;
  /** Highest published episode number, shown in the caption's meta line —
   *  the thing a returning viewer actually scans a rail for. Omitted for
   *  movies and for shows with no episodes yet. */
  latestEpisode?: number;
  /** 1-based rank — when set, renders a big stroked numeral behind the
   *  bottom-left corner of the poster, Top-10-rail style. */
  rank?: number;
  /** Bigger poster + deeper drop shadow — used for the Top 10 rail so it
   *  reads with the same weight as the hero banner above it. */
  large?: boolean;
  /** Season number, shown as a pill instead of the title. Only the
   *  seasons row passes this: everywhere else the season is part of the
   *  title text or the meta line, and repeating it would say the same
   *  thing twice. */
  seasonNumber?: number;
  /** Season number of the paid season that follows this (free) one.
   *  Renders a gold "season N" chip — the reason the free row exists,
   *  said out loud on the card. */
  continuesAtSeason?: number;
  /** Drop the caption entirely and let the season pill be the label.
   *  Inside a per-series season row the heading above already names the
   *  show, so repeating it under every card says the same thing three
   *  times and pushes the one distinguishing bit — the season — down. */
  titleFromSeason?: boolean;
  /** Leave the access badge off the artwork. Set by a rail whose cards
   *  all share one access level: the badge is then printed once in the
   *  row's own heading instead of stamped over every poster in it. */
  hideAccessBadge?: boolean;
}

/**
 * Green means "watchable now", gold means "needs a membership" — the same
 * two colours the access badge on the poster already uses.
 */
const ACCESS_CHIP = {
  free: 'bg-[#2FD98C]/14 text-[#2FD98C] ring-[#2FD98C]/35',
  member: 'bg-[#F5C563]/12 text-[#F5C563] ring-[#F5C563]/30',
} as const;

/**
 * Every caption is exactly this tall — one title line plus one meta line
 * — whether or not the
 * show actually has an episode count, a season, or a "finished" tag to
 * put in it. Cards in a rail are laid out side by side, so a caption that
 * grows a line on one card and not the next is what makes a row look
 * broken; reserving the space unconditionally is what makes that
 * impossible rather than merely unlikely.
 */
const CAPTION_H = 'h-[34px]';

export default function ShowCard({
  show,
  onClick,
  latestEpisode,
  rank,
  large,
  seasonNumber,
  titleFromSeason,
  continuesAtSeason,
  hideAccessBadge,
}: ShowCardProps) {
  const [loaded, setLoaded] = useState(false);
  const tiltRef = useRef<HTMLDivElement>(null);
  const { lang } = useLang();
  const t = appText[lang];

  // The season this card is, read off its own title — the catalog keeps it
  // in the title text rather than a column (see lib/seasons).
  const { season: ownSeason } = parseSeason(show.title);

  // Added within the last week — a plain fact read off created_at, not an
  // admin toggle, so it clears on its own instead of needing to be turned
  // off by hand once a title stops being new.
  const isNew =
    !!show.created_at && Date.now() - new Date(show.created_at).getTime() < 7 * 24 * 60 * 60 * 1000;

  // Subtle pointer-driven 3D tilt — mouse only.
  //
  // Pointer Events unify mouse and finger, which is exactly the problem:
  // on a phone this fired on the drag that scrolls the rail, so every
  // card under the finger was being re-composited on a 3D layer during
  // the one interaction that has to stay at frame rate.
  const [canTilt, setCanTilt] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    setCanTilt(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCanTilt(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = tiltRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${(-py * 10).toFixed(2)}deg) rotateY(${(px * 10).toFixed(2)}deg)`;
  };
  const resetTilt = () => {
    const el = tiltRef.current;
    if (el) el.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg)';
  };

  // The one badge the poster carries, top-left. A card used to be able to
  // show four at once — access, season, "new", coming soon — stacked over
  // the art in two corners, which is what buried the artwork the row is
  // there to show. Exactly one wins here, in order of what a viewer has
  // to know before tapping: nothing plays yet > it costs a dollar > it is
  // open > it needs a membership. Everything else moved to the caption.
  const accessBadge = show.coming_soon ? (
    <Badge tone="mark" onArt icon={<Clock className="h-3 w-3" />}>
      {t.comingSoonLabel}
    </Badge>
  ) : show.type === 'movie' ? (
    show.is_free ? (
      <Badge tone="free" onArt>
        {t.freeBadge}
      </Badge>
    ) : (
      <Badge tone="price" onArt>
        ${MOVIE_PRICE}
      </Badge>
    )
  ) : (
    <Badge
      tone={show.is_free ? 'free' : 'vip'}
      onArt
      icon={show.is_free ? undefined : <Crown className="h-3 w-3" />}
    >
      {show.is_free ? t.freeBadge : t.vipBadge}
    </Badge>
  );

  // The meta line under the title: season, episode count, and whether the
  // series has finished — the three details a viewer scans a rail for,
  // on one line, in one muted weight, separated by dots. Kept as an array
  // so the separators fall between whatever actually exists rather than
  // being hardcoded around fields that may be absent.
  const meta: string[] = [];
  if (ownSeason !== null && seasonNumber === undefined) {
    meta.push(`${t.seasonShort}${ownSeason}`);
  }
  if (show.type !== 'movie' && !!latestEpisode) {
    meta.push(`${t.epShort} ${latestEpisode}`);
  }

  return (
    <button
      onClick={() => onClick(show)}
      className={`group relative shrink-0 text-left ${
        large ? 'w-[128px] sm:w-[164px]' : rank ? 'w-[122px] sm:w-[160px]' : 'w-[112px] sm:w-[136px]'
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
            color: 'rgba(0,0,0,0.5)',
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
        onPointerMove={canTilt ? handlePointerMove : undefined}
        onPointerLeave={canTilt ? resetTilt : undefined}
        className="relative z-10"
        style={{ transition: 'transform 0.35s ease-out', transform: 'perspective(700px) rotateX(0deg) rotateY(0deg)' }}
      >
        {/* The poster frame. Its lit state is the row's colour, not one
            fixed blue: `--row-accent` is published by the RailRow this
            card sits in (see lib/rowAccent), so a cover in the free row
            lifts in green and one in the movies row in gold. */}
        <div
          className={`poster-frame aspect-[2/3] overflow-hidden rounded-[3px] bg-[#141416] ring-1 ring-white/[0.09] transition duration-300 ease-out ${
            large ? 'shadow-[0_18px_46px_rgba(0,0,0,0.7)]' : 'shadow-[0_6px_18px_rgba(0,0,0,0.5)]'
          }`}
        >
          {!loaded && <div className="absolute inset-0 skeleton-shimmer bg-[#141416]" />}
          <img
            src={show.poster_url ?? ''}
            alt={show.title}
            loading="lazy"
            decoding="async"
            // The box is already `aspect-[2/3]`, so these do not affect
            // layout — they tell the browser the intrinsic ratio before
            // the bytes arrive, which is what stops a rail from
            // reflowing card by card as its posters decode.
            width={600}
            height={900}
            onLoad={() => setLoaded(true)}
            className={`h-full w-full object-cover ${loaded ? 'img-fade loaded' : 'img-fade'}`}
          />
          {/* Bottom gradient — only where something is actually printed
              over the art. An unranked cover carries nothing down there
              any more, so darkening it was dimming the artwork for no
              reason. */}
          {rank && (
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.95) 100%)' }}
            />
          )}
          {/* Ranked cards print only the episode count over the art —
              the title is already lettered into the poster itself, the
              same reason the caption below carries none either. */}
          {rank && show.type !== 'movie' && !!latestEpisode && (
            <div className="absolute inset-x-0 bottom-0 z-[1] p-2.5">
              <p className="truncate text-[11px] font-bold text-white/85 drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]">
                {t.epShort} {latestEpisode}
              </p>
            </div>
          )}

          {!hideAccessBadge && <div className="absolute left-1.5 top-1.5 z-[2]">{accessBadge}</div>}

          {/* NEW — a dot, not a pill. A rail can have several live at
              once, and the word stopped adding anything past the first
              one a viewer had already seen on the same screen. */}
          {!show.coming_soon && isNew && (
            <span
              className="absolute right-2 top-2 z-[2] h-2.5 w-2.5 rounded-full bg-[#FF6B60] ring-2 ring-[#000000]"
              style={{ boxShadow: '0 0 8px rgba(255,107,96,0.7)' }}
              aria-label={t.newTag ?? 'NEW'}
              title={t.newTag ?? 'NEW'}
            />
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

      {/* A ranked card already carries its title on the artwork. */}
      {!rank &&
        (titleFromSeason && seasonNumber !== undefined ? (
          // Inside a franchise row the heading already names the show, so
          // the season number is the whole caption — and it carries the
          // row's one useful signal in its colour: green seasons are
          // watchable now, gold ones need a membership.
          <div className={`mt-2 flex items-center px-0.5 ${CAPTION_H}`}>
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-[3px] text-[11px] font-black leading-none ring-1 ring-inset ${
                show.is_free ? ACCESS_CHIP.free : ACCESS_CHIP.member
              }`}
            >
              {!show.is_free && <Crown className="h-2.5 w-2.5 shrink-0" />}
              {t.seasonShort}{seasonNumber}
            </span>
          </div>
        ) : (
          <div className={`mt-2 px-0.5 ${CAPTION_H}`}>
            {/* Title on top, then what the artwork cannot say: season,
                episode count, whether the series has finished. Both lines
                render even when empty so every card in a rail keeps the
                same height — see CAPTION_H. */}
            <p className="truncate text-[12px] font-semibold leading-none text-white/95">{show.title}</p>
            <p className="mt-[7px] flex items-center gap-1 truncate text-[10.5px] font-semibold leading-none text-white/40">
              {meta.map((part, i) => (
                <span key={part} className="shrink-0 whitespace-nowrap">
                  {i > 0 && <span className="mr-1 text-white/25">·</span>}
                  {part}
                </span>
              ))}
              {show.status === 'completed' && show.type !== 'movie' && (
                <span className="shrink-0 whitespace-nowrap text-[#FF6B60]">
                  {meta.length > 0 && <span className="mr-1 text-white/25">·</span>}
                  {t.completedTag}
                </span>
              )}
              {continuesAtSeason !== undefined && (
                <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[#F5C563]">
                  {(meta.length > 0 || show.status === 'completed') && (
                    <span className="mr-0.5 text-white/25">·</span>
                  )}
                  <Crown className="h-2.5 w-2.5 shrink-0" />
                  {t.seasonShort}{continuesAtSeason}
                </span>
              )}
            </p>
          </div>
        ))}
    </button>
  );
}
