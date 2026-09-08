import { useEffect, useRef, useState } from 'react';
import { Play, Clock, Crown, Check } from 'lucide-react';
import type { Show } from '@/lib/types';
import Badge from '@/components/Badge';
import { MOVIE_PRICE } from '@/lib/moviePurchase';
import { useLang } from '@/lib/useLang';
import { parseSeason } from '@/lib/seasons';
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
  /** Season number, shown as a small chip under the title. Only the
   *  seasons row passes this: everywhere else the season is already part
   *  of the title text, and repeating it would say the same thing twice.
   *  The seasons row strips the marker off the title so the franchise
   *  name lines up down the rail, and this chip carries the number. */
  seasonNumber?: number;
  /** Franchise name with the season marker removed — used as the card's
   *  visible title in the seasons row. */
  displayTitle?: string;
  /** Season number of the paid season that follows this (free) one.
   *  Renders a gold "season N · members" line under the title — the
   *  reason the free row exists, said out loud on the card. */
  continuesAtSeason?: number;
  /** Drop the caption entirely and let the season pill be the label.
   *  Inside a per-series season row the heading above already names the
   *  show, so repeating it under every card says the same thing three
   *  times and pushes the one distinguishing bit — the season — down. */
  titleFromSeason?: boolean;
  /** Fill the grid cell instead of taking the rail's fixed card width.
   *  A rail scrolls horizontally, so its cards need a width of their own;
   *  a grid already hands each card a cell, and a fixed width inside one
   *  either leaves a gap or overflows it. */
  fluid?: boolean;
}

/**
 * Green means "watchable now", gold means "needs a membership" — the same
 * two colours the access badge on the poster already uses. The season
 * chips take their colour from this rather than from a fixed blue, which
 * in this app reads as "a movie you can buy" and said nothing about
 * whether the season was open.
 */
const ACCESS_CHIP = {
  free: 'bg-[#2FD98C]/14 text-[#2FD98C] ring-[#2FD98C]/35',
  member: 'bg-[#F5C563]/12 text-[#F5C563] ring-[#F5C563]/30',
} as const;

export default function ShowCard({ show, onClick, latestEpisode, rank, large, seasonNumber, displayTitle, titleFromSeason, continuesAtSeason, fluid }: ShowCardProps) {
  const [loaded, setLoaded] = useState(false);
  const tiltRef = useRef<HTMLDivElement>(null);
  const { lang } = useLang();
  const t = appText[lang];

  // Added within the last week — a plain fact read off created_at, not an
  // admin toggle, so it clears on its own instead of needing to be turned
  // off by hand once a title stops being new.
  // The season this card is, read off its own title. Only surfaced on a
  // free show: the free row's offer is "this season is free", and saying
  // which one is the difference between an offer and a vague promise.
  const ownSeason = parseSeason(show.title).season;

  const isNew =
    !!show.created_at && Date.now() - new Date(show.created_at).getTime() < 7 * 24 * 60 * 60 * 1000;

  // The poster already says the show's name, in commissioned Khmer
  // lettering sized for the artwork. Anything the card prints on top of
  // that — the caption underneath, the Top 10 overlay title — is the
  // same words a second time, smaller and usually truncated. So when the
  // artwork carries the title, the card stops writing one.
  //
  // The badges stay. They say things the artwork cannot: whether it is
  // free, how many episodes there are, whether it is finished. That is
  // why the poster spec (DESIGN_SYSTEM §3គ) reserves the top and bottom
  // strips for them and puts the painted title in the middle band.
  const artHasTitle = show.poster_has_title === true;

  // Who writes the name. The card does, unless the artwork already has
  // it painted in, or this is a ranked card that draws it over the
  // poster, or the franchise row where the season pill is the label.
  const showsOwnTitle =
    !artHasTitle && !rank && !(titleFromSeason && seasonNumber !== undefined);

  // One season pill, not two competing ones: `seasonNumber` is the
  // season this card IS (franchise row), `continuesAtSeason` the paid
  // season a free one runs into. They never both apply, and the pill's
  // colour is the access of whichever season it names.
  const seasonChip =
    seasonNumber !== undefined
      ? { season: seasonNumber, free: show.is_free === true }
      : continuesAtSeason !== undefined
        ? { season: continuesAtSeason, free: false }
        : null;

  // Subtle pointer-driven 3D tilt — mouse only.
  //
  // Pointer Events unify mouse and finger, which is exactly the problem:
  // on a phone this fired on the drag that scrolls the rail, so every
  // card under the finger was being re-composited on a 3D layer during
  // the one interaction that has to stay at frame rate. Tilting a card
  // the finger is trying to flick past is not an effect anyone asked
  // for. So the handlers only attach where there is a real cursor —
  // which is also the only place a hover tilt means anything.
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

  return (
    <button
      onClick={() => onClick(show)}
      // Bigger covers. 104px was a thumbnail: at that width a Khmer
      // title truncates after two or three syllables, the artwork is a
      // smudge, and the whole rail reads as a strip of stamps. 124px on
      // a phone fits three across with the rail's own peek, and gives
      // the poster half again the area it had.
      className={`group relative text-left ${
        fluid
          ? 'w-full'
          : `shrink-0 ${large ? 'w-[150px] sm:w-[188px]' : rank ? 'w-[142px] sm:w-[184px]' : 'w-[124px] sm:w-[148px]'}`
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
        onPointerMove={canTilt ? handlePointerMove : undefined}
        onPointerLeave={canTilt ? resetTilt : undefined}
        className="relative z-10"
        style={{ transition: 'transform 0.35s ease-out', transform: 'perspective(700px) rotateX(0deg) rotateY(0deg)' }}
      >
        {/* The poster frame. Its lit state is the row's colour, not one
            fixed blue: `--row-accent` is published by the RailRow this
            card sits in (see lib/rowAccent), so a cover in the free row
            lifts in green and one in the movies row in gold. The
            fallback keeps a card outside any rail — the search grid, the
            View All grid — on the brand blue it has always used. */}
        <div
          className={`poster-frame aspect-[2/3] overflow-hidden rounded-[10px] bg-[#151926] ring-1 ring-white/[0.09] transition duration-300 ease-out group-hover:z-20 group-hover:-translate-y-2 group-hover:scale-[1.04] ${
            large ? 'shadow-[0_18px_46px_rgba(0,0,0,0.7)]' : 'shadow-[0_6px_18px_rgba(0,0,0,0.5)]'
          }`}
        >
          {!loaded && <div className="absolute inset-0 skeleton-shimmer bg-[#151926]" />}
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
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 ${
              loaded ? 'img-fade loaded' : 'img-fade'
            }`}
          />
          {/* Scrim. Only where something is actually printed on the art.
              EP and ចប់ moved off the poster and into the meta row under
              the title, so the bottom of an ordinary cover carries
              nothing and no longer needs darkening — the old wash ran
              from 50% down to 0.9 opacity over artwork it was not
              protecting anything from. What is left: a short strip under
              the top badges, and, for a ranked card only, the deep wash
              its overlaid title still needs. */}
          <div
            className="absolute inset-0"
            style={{
              background: rank
                ? 'linear-gradient(180deg, rgba(10,16,30,0.5) 0%, rgba(10,16,30,0) 18%, rgba(10,16,30,0) 45%, rgba(10,16,30,0.95) 100%)'
                : 'linear-gradient(180deg, rgba(10,16,30,0.5) 0%, rgba(10,16,30,0) 18%, rgba(10,16,30,0) 100%)',
            }}
          />
          {/* Title — overlaid directly on the poster for ranked (Top 10)
              cards so the row reads as pure artwork instead of poster +
              caption; other rows keep the plain caption below the card.
              Single-line with an ellipsis when it's too long to fit, gold
              by default (not just on hover) to match the numeral behind
              it. */}
          {rank && !artHasTitle && (
            <div className="absolute inset-x-0 bottom-0 z-[1] p-2.5">
              <h3 className="truncate text-[13px] font-bold leading-tight text-[#FFE7B0] drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] sm:text-[13px]">
                {show.title}
              </h3>
            </div>
          )}
          {/* EP n, ចប់ and a movie's price used to sit down here on the
              artwork. They are in the meta row under the title now — see
              the comment on <Meta> below. */}
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
          {/* Which season is the free one, stacked under the FREE badge.
              "Free" on a series that runs to several seasons is ambiguous
              on its own — this makes the offer exact. Skipped in a franchise
              row, where the caption pill below already carries the season. */}
          {!show.coming_soon && show.is_free && ownSeason !== null && seasonNumber === undefined && (
            <span
              className={`absolute left-1.5 top-[26px] inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-[3px] text-[9.5px] font-bold leading-none shadow-[0_2px_8px_rgba(2,4,10,0.5)] ring-1 ring-inset backdrop-blur-sm ${ACCESS_CHIP.free}`}
            >
              {t.seasonShort}{ownSeason}
            </span>
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
      {/* Caption. A title line, when the card is the one saying the
          name, and under it one meta row.

          The meta row is where EP n and ចប់ live now. They used to sit
          on the poster's bottom corners, which cost twice: the artwork
          needed a dark wash under them to stay legible, and on a cover
          with the title painted into the lower third they landed on the
          lettering. Underneath the title they are reading matter rather
          than stickers — "EP 21, and it is finished" is one sentence
          about the show, in the place a sentence about the show belongs.

          Its height is reserved rather than measured. A rail puts cards
          with an EP badge next to cards without one, and a row that
          collapses on some cards leaves the covers in a rail sitting at
          different heights. It is one line, never two: chips are
          shrink-0 inside an overflow-hidden row, so a card that somehow
          carries four of them clips the last instead of growing. */}
      <div className="mt-2 px-0.5">
        {showsOwnTitle && (
          <h3 className={`truncate font-semibold text-white/95 transition group-hover:text-[#4E86FF] ${large ? 'text-[14px]' : 'text-[13.5px]'}`}>
            {displayTitle ?? show.title}
          </h3>
        )}
        <div className={`flex min-h-[18px] items-center gap-1 overflow-hidden ${showsOwnTitle ? 'mt-1' : ''}`}>
          {show.type !== 'movie' && !!latestEpisode && (
            <Badge tone="info" className="shrink-0">
              EP {latestEpisode}
            </Badge>
          )}
          {/* Finished, marked on the show instead of in a row of its own.
              A whole rail for "completed" spends a screenful saying one
              boolean; the fact belongs beside the episode count it
              qualifies — "21 episodes" and "it is all there" are one
              thought.

              Neutral, not green: green means free in this app and these
              cards sit in rails beside FREE badges, so a green ចប់ on a
              members-only series would read as the wrong promise. */}
          {!show.coming_soon && show.status === 'completed' && (
            <Badge tone="info" icon={<Check className="h-3 w-3" />} className="shrink-0">
              {t.completedTag}
            </Badge>
          )}
          {/* A standalone film's price, where a series shows its latest
              episode number. Both answer the same question in a rail —
              "what do I get if I tap this" — and a movie's answer is a
              dollar, once, with no membership involved. */}
          {show.type === 'movie' && !show.is_free && !show.coming_soon && (
            <Badge tone="price" className="shrink-0">
              ${MOVIE_PRICE}
            </Badge>
          )}
          {/* The season pill. In a franchise row it is the whole label:
              two seasons of one show sit side by side under the same
              (often identical) artwork, so the number is the only thing
              telling the cards apart. Its colour is that season's own
              access, so the row reads at a glance as "green ones I can
              watch, gold ones I cannot" — which is the question the row
              exists to answer. `continuesAtSeason` is the mirror image:
              on a free season, the paid one it runs into. */}
          {seasonChip !== null && (
            <span
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-[3px] text-[9.5px] font-bold leading-none ring-1 ring-inset ${
                seasonChip.free ? ACCESS_CHIP.free : ACCESS_CHIP.member
              }`}
            >
              {!seasonChip.free && <Crown className="h-2.5 w-2.5 shrink-0" />}
              {t.seasonShort}{seasonChip.season}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
