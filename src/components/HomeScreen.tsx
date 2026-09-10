import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Star,
  ChevronLeft,
  ChevronRight,
  Search,
  Flame,
  User,
  Crown,
  Gift,
  X,
  Home,
  Tv,
  Film,
  Bookmark,
  Plus,
  Check,
  Play,
  Clock,
  Layers,
  ListVideo,
  Radio,
  Calendar,
} from 'lucide-react';
import type { Show, ShowWithGenres, Genre } from '@/lib/types';
import { fetchAllShows, fetchGenres, fetchTickerMessage, fetchShowEpisodeInfo, errorMessage, type ShowEpisodeInfo } from '@/lib/api';
import ShowCard from '@/components/ShowCard';
import Badge, { type BadgeTone } from '@/components/Badge';
import MovieCard from '@/components/MovieCard';
import SupporterTicker from '@/components/SupporterTicker';
import CreatorCredit from '@/components/CreatorCredit';
import NotificationBell from '@/components/NotificationBell';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import { getCurrentTelegramProfile } from '@/lib/telegram';
import { toggleWatchlist, isInWatchlist, getContinueWatching, type ContinueItem } from '@/lib/watchlist';
import { seasonFranchises, nextPaidSeason, parseSeason } from '@/lib/seasons';
import { ROW_ACCENT, tint, type RowRole } from '@/lib/rowAccent';

interface HomeScreenProps {
  onSelectShow: (show: Show) => void;
  onOpenProfile: () => void;
  onOpenSubscription: () => void;
  onOpenWatchlist: () => void;
  onOpenRewards: () => void;
  avatarUrl: string | null;
  subscribed: boolean;
  /** Whether a lucky-draw reward is still up for grabs — controls the
   *  glowing gift badge next to Subscribe. `null` hides the badge. */
  rewardsAvailable: 'guest' | 'spin-ready' | null;
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  onOpenLegal?: () => void;
  /** Resume a "continue watching" item straight into the player — same
   *  handler App.tsx already gives WatchlistScreen, reused here so the
   *  home-row cards behave identically. */
  onResumeEpisode: (show: Show, episodeId: string) => void;
}

export type Tab = 'home' | 'search' | 'watchlist' | 'account';

const HERO_AUTO_MS = 6000;

// Small, purely-cosmetic emoji lookup for genre rail headers — gives each
// row a bit of personality at a glance without needing extra icon assets.
// Falls back to a generic clapperboard for anything unmapped.
const GENRE_EMOJI: Record<string, string> = {
  action: '⚔️',
  adventure: '🧭',
  comedy: '😂',
  drama: '🎭',
  fantasy: '🧙',
  horror: '👻',
  mystery: '🔍',
  romance: '💕',
  'sci-fi': '🚀',
  scifi: '🚀',
  'slice-of-life': '🍃',
  sliceoflife: '🍃',
  sports: '⚽',
  supernatural: '🌙',
  thriller: '🔪',
  psychological: '🧠',
  mecha: '🤖',
  isekai: '🌀',
  magic: '✨',
  school: '🎒',
  music: '🎵',
  historical: '🏯',
  martial_arts: '🥋',
  'martial-arts': '🥋',
};
const genreEmoji = (slug: string) => GENRE_EMOJI[slug.toLowerCase()] ?? '🎬';

// Custom clapperboard glyph for the "New Release" row — drawn in the same
// stroke convention as the lucide set we use everywhere else (24x24,
// currentColor, 2px rounded strokes) so it sits next to Flame/Gift/Clock
// without looking like a different icon family.
function ClapperIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 8.6 20 5l1 4-17 3.6z" />
      <path d="M4 12h16v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="m7.5 8.3 2-4.2M12.5 7.3l2-4.2M17.3 6.3l1.7-3.6" />
    </svg>
  );
}

export default function HomeScreen({
  onSelectShow,
  onOpenProfile,
  onOpenSubscription,
  onOpenWatchlist,
  onOpenRewards,
  avatarUrl,
  subscribed,
  rewardsAvailable,
  activeTab,
  setActiveTab,
  searchOpen,
  setSearchOpen,
  onOpenLegal,
  onResumeEpisode,
}: HomeScreenProps) {
  const { lang, setLang } = useLang();
  const t = appText[lang];
  const telegramProfile = getCurrentTelegramProfile();
  const [bannerShows, setBannerShows] = useState<Show[]>([]);
  const [shows, setShows] = useState<ShowWithGenres[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [interacting, setInteracting] = useState(false);
  // `movies: true` switches the drill-down to the wide film cards. There
  // are only ever a handful of standalone movies, so they get a shelf
  // built for a handful rather than a grid built for hundreds.
  const [viewAll, setViewAll] = useState<{
    title: string;
    shows: Show[];
    movies?: boolean;
  } | null>(null);
  const [tickerMessage, setTickerMessage] = useState<string | undefined>(undefined);
  const [episodeInfo, setEpisodeInfo] = useState<Record<string, ShowEpisodeInfo>>({});

  const touchStartX = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Continue Watching" — read once per mount (this screen fully
  // unmounts/remounts on navigation, so a fresh read here already stays
  // current without needing a storage listener).
  const [continueItems] = useState<ContinueItem[]>(() => getContinueWatching());
  // The header is see-through over the hero and picks up its dark blur as
  // soon as the page moves — without this it stayed transparent all the way
  // down, so poster art and row titles scrolled straight under the logo and
  // the VIP button. Throttled to one read per frame and registered passive,
  // so it never fights the scroll itself.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setScrolled(window.scrollY > 40);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [s, g] = await Promise.all([fetchAllShows(), fetchGenres()]);
        if (!active) return;
        // Hero is now literally the Top 10 (by real view count) carousel —
        // no separate "featured" pool, so what's promoted at the top is
        // always exactly what the Top 10 Viewer row/rank shows elsewhere.
        const top10 = [...s].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)).slice(0, 10);
        setBannerShows(top10);
        setShows(s);
        setGenres(g);
        fetchShowEpisodeInfo().then((info) => {
          if (active) setEpisodeInfo(info);
        });
      } catch (e: unknown) {
        if (!active) return;
        setError(errorMessage(e, 'Failed to load content'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchTickerMessage().then((msg) => {
      if (active && msg) setTickerMessage(msg);
    });
    return () => {
      active = false;
    };
  }, []);

  // show id -> highest published episode number, for the cards' EP badge.
  const episodeNumbers = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [id, info] of Object.entries(episodeInfo)) map[id] = info.latestEpisode;
    return map;
  }, [episodeInfo]);

  const wrap = useCallback(
    (i: number) => (bannerShows.length + i) % bannerShows.length,
    [bannerShows.length],
  );

  const goToSlide = useCallback(
    (i: number) => setHeroIndex(wrap(i)),
    [wrap],
  );

  const nextSlide = useCallback(() => goToSlide(heroIndex + 1), [heroIndex, goToSlide]);
  const prevSlide = useCallback(() => goToSlide(heroIndex - 1), [heroIndex, goToSlide]);

  const pauseThenResume = useCallback(() => {
    setInteracting(true);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setInteracting(false), 3500);
  }, []);

  // Auto-advance the centered card every ~5.5s, pause while interacting
  useEffect(() => {
    if (bannerShows.length <= 1 || interacting) {
      if (autoTimer.current) clearInterval(autoTimer.current);
      return;
    }
    autoTimer.current = setInterval(() => goToSlide(heroIndex + 1), HERO_AUTO_MS);
    return () => {
      if (autoTimer.current) clearInterval(autoTimer.current);
    };
  }, [bannerShows.length, interacting, heroIndex, goToSlide]);

  const hero = bannerShows[heroIndex];

  const filteredShows = query.trim()
    ? shows.filter((s) => s.title.toLowerCase().includes(query.toLowerCase()))
    : shows;

  // Top 10 now reflects real audience behavior — actual play counts
  // (see increment_show_view_count) — instead of an admin-typed rating
  // number, so it genuinely shows which shows viewers watch the most.
  const trending = [...shows].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)).slice(0, 10);
  const newReleases = [...shows]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 10);
  const comingSoon = shows.filter((s) => s.coming_soon);
  const freeShows = shows.filter((s) => s.is_free && !s.coming_soon);
  const oneOffMovies = shows.filter((s) => s.type === 'movie' && !s.coming_soon);

  // One group per series that actually has several seasons in the
  // catalog. The season lives in the title text rather than a column, so
  // this is parsed — see lib/seasons.ts for the five spellings the data
  // uses. Each franchise gets its own row below, rather than all of them
  // sharing one rail: in a shared rail the two seasons of a show sat
  // under the same truncated title and read as a duplicate card.
  // A free show that continues into a paid season is the whole point of
  // the free row — the card says so rather than leaving the viewer to
  // discover it after finishing the last free episode.
  const continuesAt = useMemo(() => {
    const out: Record<string, number> = {};
    for (const show of freeShows) {
      const next = nextPaidSeason(show, shows);
      if (next) out[show.id] = parseSeason(next.title).season ?? 1;
    }
    return out;
  }, [freeShows, shows]);

  const franchises = useMemo(
    () => seasonFranchises(shows.filter((s) => !s.coming_soon)),
    [shows],
  );

  // The long ones. A viewer with an evening free wants the shows they can
  // actually sink into, and episode count is the honest signal for that —
  // it needs no admin curation and cannot go stale.
  const bingeShows = useMemo(
    () =>
      shows
        .filter((s) => !s.coming_soon && (episodeNumbers[s.id] ?? 0) >= 20)
        .sort((a, b) => (episodeNumbers[b.id] ?? 0) - (episodeNumbers[a.id] ?? 0))
        .slice(0, 14),
    [shows, episodeNumbers],
  );

  // Still releasing. Separated from the Completed row so the two answer
  // opposite questions: "what can I finish tonight" vs "what do I follow".
  const ongoingShows = shows.filter(
    (s) => s.type === 'series' && s.status !== 'completed' && !s.coming_soon,
  );
  // The single movie the panel leads with — most-watched first (same
  // real play-count signal `trending` uses above), so the one card the
  // row spends its height on is the one most people already want.
  const featuredMovie = [...oneOffMovies].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))[0];

  // bannerShows come from fetchFeaturedShows (a plain Show, no genres
  // joined) — this looks the hero's genre + Top 10 rank up against the
  // already-loaded `shows` list (ShowWithGenres) instead of a second query.
  const showsById = new Map(shows.map((s) => [s.id, s]));
  const trendingRank = new Map(trending.map((s, i) => [s.id, i + 1]));

  const showsByGenre = useCallback(
    (slug: string) => shows.filter((s) => s.genres?.some((g) => g.slug === slug)),
    [shows],
  );

  // "Recommended for You" — a light personalization pass using only what
  // we already have on hand: the genre(s) of whatever's in Continue
  // Watching. No separate taste-profile query, no cold-start UI to design
  // — shows with no history simply don't get the row (handled below), and
  // it recomputes for free every time continueItems does since it's a
  // plain derived value, not its own effect.
  const recommended = useMemo(() => {
    if (continueItems.length === 0) return [];
    const watchedIds = new Set(continueItems.map((c) => c.show.id));
    const genreCounts = new Map<string, number>();
    for (const item of continueItems) {
      for (const g of showsById.get(item.show.id)?.genres ?? []) {
        genreCounts.set(g.slug, (genreCounts.get(g.slug) ?? 0) + 1);
      }
    }
    const topGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).map(([slug]) => slug);
    if (topGenres.length === 0) return [];
    const seen = new Set<string>();
    const picks: ShowWithGenres[] = [];
    for (const slug of topGenres) {
      for (const s of showsByGenre(slug)) {
        if (watchedIds.has(s.id) || seen.has(s.id)) continue;
        seen.add(s.id);
        picks.push(s);
        if (picks.length >= 10) break;
      }
      if (picks.length >= 10) break;
    }
    return picks;
  }, [continueItems, showsById, showsByGenre]);

  if (loading) {
    return (
      <div className="min-h-screen bg-app text-white">
        {/* Header skeleton */}
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-8 sm:py-3.5">
          <div className="h-9 w-9 animate-pulse rounded-full bg-white/10" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3.5 w-24 animate-pulse rounded bg-white/10" />
            <div className="hidden h-2 w-16 animate-pulse rounded bg-white/5 sm:block" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden h-8 w-32 animate-pulse rounded-full bg-white/5 sm:block" />
            <div className="h-8 w-24 animate-pulse rounded-full bg-white/5" />
          </div>
        </div>

        {/* Hero skeleton */}
        <div className="relative w-full overflow-hidden" style={{ height: 'min(28vh, 250px)' }}>
          <div className="skeleton-shimmer absolute inset-0 bg-white/[0.03]" />
          <div className="relative flex h-full items-center justify-center gap-3">
            <div className="h-[58%] w-[22%] max-w-[124px] animate-pulse rounded-xl bg-white/5" />
            <div className="h-[74%] w-[38%] max-w-[164px] animate-pulse rounded-xl bg-white/10" />
            <div className="h-[58%] w-[22%] max-w-[124px] animate-pulse rounded-xl bg-white/5" />
          </div>
        </div>

        {/* Rail skeletons */}
        <div className="mx-auto max-w-[1400px] px-4 pt-8 sm:px-8">
          {[0, 1, 2].map((row) => (
            <div key={row} className="mb-9">
              <div className="mb-3 h-4 w-32 animate-pulse rounded bg-white/10" />
              <div className="flex gap-4 overflow-hidden">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="aspect-[2/3] w-28 shrink-0 animate-pulse rounded-lg bg-white/5 sm:w-36"
                    style={{ animationDelay: `${(row * 6 + i) * 60}ms` }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app px-6">
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold text-[#E6231F]">{t.somethingWrong}</p>
          <p className="mt-2 text-sm text-[#9AA4BD]">{error}</p>
        </div>
      </div>
    );
  }

  const heroVisible = hero && !query.trim();


  return (
    <div className="relative min-h-screen bg-app text-white">
      {/* No page-wide artwork or ambient wash: the background is flat
          black, and the only light on the screen comes from the hero's own
          blurred poster below. Keeping it a plain colour (rather than a
          fixed image or a fixed-attachment gradient) is also what keeps
          scrolling smooth on phones — fixed backdrops force a repaint of
          the whole viewport on every frame of a scroll. */}

      {/* Header V2 — a floating glass capsule inset from the edges instead
          of a flush edge-to-edge bar, so the chrome reads as an object
          sitting over the content rather than a strip the content runs
          under. Transparent (no pill, no border) while the hero is showing
          at rest, so the coverflow gets the full top of the screen; the
          capsule condenses in — border, blur, shadow — the moment the
          person scrolls. Every control inside kept its exact handler from
          v5; only the container and the active-state language changed.

          The outer `<header>` itself now carries the same solid backdrop
          once scrolled, not just the inner pill: the padding that insets
          the pill from the screen edges is otherwise a fully transparent
          strip, and whatever the page had just scrolled past (hero art,
          the top of the first rail) showed straight through it as a
          cropped sliver above the pill. */}
      <header
        className={`fixed inset-x-0 top-0 z-50 px-2.5 pt-2.5 transition-colors duration-300 sm:px-6 sm:pt-4 ${
          heroVisible && !scrolled ? 'bg-transparent' : 'bg-black/60 backdrop-blur-2xl'
        }`}
      >
        <div
          className={`no-scrollbar mx-auto flex max-w-[1400px] flex-nowrap items-center gap-3 overflow-x-auto rounded-[20px] px-2 py-2 transition-all duration-300 sm:gap-5 sm:rounded-[24px] sm:px-5 sm:py-2.5 ${
            heroVisible && !scrolled
              ? 'border border-transparent bg-transparent'
              : 'border border-white/10 bg-black/60 shadow-[0_10px_36px_rgba(0,0,0,0.45)] backdrop-blur-2xl'
          }`}
        >
          {/* Identity — avatar + username, borderless at rest. The
              Telegram app-icon button that used to sit here was removed
              earlier: Telegram already prints "NINTANIME mini app" above,
              so it was a third piece of branding pushing the person's own
              name off-screen on narrow phones. */}
          <button
            onClick={onOpenProfile}
            aria-label={t.navAccount}
            className="flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-1 transition hover:bg-white/[0.06] sm:gap-2"
          >
            <div className={`relative h-7 w-7 shrink-0 rounded-full sm:h-8 sm:w-8 ${subscribed ? 'shadow-glow-gold' : ''}`}>
              <div
                className={`flex h-full w-full items-center justify-center overflow-hidden rounded-full ring-2 ${
                  subscribed ? 'ring-[#F5C563]' : 'ring-white/20'
                }`}
              >
                {telegramProfile?.photoUrl ? (
                  <img
                    src={telegramProfile.photoUrl}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    src="/assets/images/icon-192.png"
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              {subscribed && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-vip-gradient ring-2 ring-[#0A101E]">
                  <Crown className="h-2 w-2 text-black" />
                </span>
              )}
              {rewardsAvailable === 'spin-ready' && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-glow-pulse rounded-full bg-[#FF6B60] ring-2 ring-[#0A101E]"
                  aria-hidden
                />
              )}
            </div>
            {(telegramProfile?.username || telegramProfile?.fullName) && (
              <span className="max-w-[64px] truncate text-xs font-bold text-white xs:max-w-[92px] sm:max-w-[130px]">
                {telegramProfile.username ? `@${telegramProfile.username}` : telegramProfile.fullName}
              </span>
            )}
          </button>

          {/* Divider — marks where "browse" ends and personal/account
              utility begins. One hairline does this instead of boxing
              every control that follows it. */}
          <span className="hidden h-5 w-px shrink-0 bg-white/10 sm:block" aria-hidden />

          {/* Nav links — a segmented pill group now instead of an
              underline: the active link sits on its own filled capsule,
              the same "filled = here" language the redesigned bottom dock
              uses, so desktop and mobile navigation read as one idea. */}
          <nav className="no-scrollbar hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:flex">
            <NavLink
              label={t.navHome}
              active={!viewAll && !query.trim()}
              onClick={() => {
                setActiveTab('home');
                setQuery('');
                setViewAll(null);
              }}
            />
            <NavLink
              label={t.navSeries}
              active={viewAll?.title === t.navSeries}
              onClick={() => {
                setQuery('');
                setViewAll({ title: t.navSeries, shows: shows.filter((s) => s.type === 'series') });
              }}
            />
            <NavLink
              label={t.navMovies}
              active={viewAll?.title === t.navMovies}
              onClick={() => {
                setQuery('');
                setViewAll({ title: t.navMovies, shows: shows.filter((s) => s.type === 'movie'), movies: true });
              }}
            />
            <NavLink label={t.navMyList} active={false} onClick={onOpenWatchlist} highlight={continueItems.length > 0} />
          </nav>

          {/* Search — icon button opens the full-screen overlay below
              `sm:`; an inline expanding box from `sm:` up. */}
          <button
            onClick={() => setSearchOpen(true)}
            aria-label={t.navSearch}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/8 hover:text-white sm:hidden"
          >
            <Search className="h-4 w-4" />
          </button>
          <div className="relative hidden shrink-0 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6A7591]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-44 rounded-full border border-white/10 bg-white/[0.05] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none transition focus:w-60 focus:border-[#2050D8]/50 focus:bg-white/[0.08]"
            />
          </div>

          {/* Bell + VIP — per the requested header layout (logo · bell ·
              VIP), kept visible on every screen size and every scroll
              position, not just the bottom utility bar. */}
          <NotificationBell title={t.notifications ?? 'Notifications'} emptyLabel={t.noNotifications ?? ''} />
          <button
            onClick={onOpenSubscription}
            aria-label={t.premium}
            className={
              subscribed
                ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#F5C563] transition hover:bg-[#F5C563]/10'
                : 'flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-black text-white transition active:scale-95 sm:gap-1.5 sm:px-3.5 sm:py-1.5 sm:text-xs'
            }
            // Gold still marks VIP status (the crown, once they have it);
            // red marks the action that takes money, here and inside the
            // checkout this button opens.
            style={
              subscribed
                ? undefined
                : { backgroundImage: 'linear-gradient(135deg, var(--co-brand) 0%, var(--co-brand-deep) 100%)' }
            }
          >
            <Crown className={subscribed ? 'h-4 w-4' : 'h-3 w-3 sm:h-3.5 sm:w-3.5'} />
            {!subscribed && (t.vipBadge ?? 'VIP')}
          </button>
        </div>
      </header>

      {/* Everything below the fixed header sits in one padded flow —
          ticker directly under it, hero right after. The ticker used to
          be a `fixed` overlay guessing the header's pixel height, which is
          what made it visually collide with the header controls; being
          in-flow here means it can never land on top of them. */}
      <div className="relative z-10 pt-[60px] sm:pt-[76px]">
        <SupporterTicker
          staticMessage={tickerMessage}
        />

        {/* Spotlight coverflow hero */}
        {heroVisible && (
          <CoverflowHero
            shows={bannerShows}
            index={heroIndex}
            hero={hero}
            heroGenre={showsById.get(hero.id)?.genres?.[0]?.name}
            heroRank={trendingRank.get(hero.id)}
            heroIsFree={showsById.get(hero.id)?.is_free ?? hero.is_free ?? false}
            heroIsMovie={(showsById.get(hero.id)?.type ?? hero.type) === 'movie'}
            onSelectShow={onSelectShow}
            onPrev={prevSlide}
            onNext={nextSlide}
            onGoTo={goToSlide}
            onTouchStart={(x) => {
              touchStartX.current = x;
              pauseThenResume();
            }}
            onTouchEnd={(x) => {
              const dx = x - touchStartX.current;
              if (dx < -40) nextSlide();
              else if (dx > 40) prevSlide();
            }}
            t={t}
          />
        )}
      </div>

      {/* Content — default browse state is a single-screen layout (Top 10
          hero row + a tab switcher for New Release / Popular / each genre,
          one row visible at a time) so home never needs a vertical drag to
          see everything. Search results and "View All" stay as normal
          scrollable grids since those are explicit drill-down views, not
          the main browse screen. */}
      <main className="relative z-10 mx-auto max-w-[1400px] px-4 pb-28 sm:px-8 sm:pb-14">
        {viewAll ? (
          <section className="pt-4">
            <div className="mb-5 flex items-center gap-3">
              <button
                onClick={() => setViewAll(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:bg-white/10"
                aria-label="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="text-xl font-bold">{viewAll.title}</h2>
            </div>
            {viewAll.shows.length === 0 ? (
              <p className="py-20 text-center text-[#6A7591]">{t.noResults}</p>
            ) : viewAll.movies ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {viewAll.shows.map((s) => (
                  <MovieCard key={s.id} show={s} onClick={onSelectShow} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                {viewAll.shows.map((s) => (
                  <ShowCard key={s.id} show={s} onClick={onSelectShow} latestEpisode={episodeNumbers[s.id]} />
                ))}
              </div>
            )}
          </section>
        ) : query.trim() ? (
          <section className="pt-4">
            <h2 className="mb-5 text-xl font-bold">
              {t.resultsFor} &ldquo;{query}&rdquo;{' '}
              <span className="text-[#6A7591]">({filteredShows.length})</span>
            </h2>
            {filteredShows.length === 0 ? (
              <p className="py-20 text-center text-[#6A7591]">{t.noResults}</p>
            ) : (
              <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                {filteredShows.map((s) => (
                  <ShowCard key={s.id} show={s} onClick={onSelectShow} latestEpisode={episodeNumbers[s.id]} />
                ))}
              </div>
            )}
          </section>
        ) : (
          <div className="pt-3">
            {/* Free-to-watch leads the page. Everything below it needs a
                membership, so the one row a signed-out viewer can act on
                immediately goes first rather than three rows down — and it
                gets the showcase panel treatment (in green, not the
                Movies row's gold) so it reads as an offer, not a filter.
                Empty until shows are marked "unlock all" (shows.is_free)
                in Admin -> Shows; the row hides itself until then. */}
            {freeShows.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                panel
                role="free"
                icon={<Gift className="h-5 w-5" />}
                title={t.freeRowLabel ?? 'Free to Watch'}
                shows={freeShows}
                onSelectShow={onSelectShow}
                continuesAt={continuesAt}
                onViewAll={() => setViewAll({ title: t.freeRowLabel ?? 'Free to Watch', shows: freeShows })}
                viewAllLabel={t.viewAll}
                tag={{ label: t.unlockAllTag, tone: 'free' }}
                hideAccessBadge
              />
            )}
            {/* The ranked/numeral "Top 10" rail was removed per request —
                the featured carousel above already surfaces what's trending
                without repeating it as a second ranked row underneath. */}
            {/* "Movies" showcase replaces the old "Continue Watching" row
                here — the prime top-of-page spot now goes to the one-off
                paid films instead, since there are only ever a handful of
                them and they're easy to miss buried in a compact rail
                further down. Down to a single card — the most-watched
                movie — instead of a whole rail or grid, so the panel
                stays short enough that the row underneath is still on
                screen without scrolling. The rest of the catalog is one
                tap away behind "View All" whenever there's more than one. */}
            {featuredMovie && (
              <section
                className="rail-section mt-8 overflow-hidden rounded-2xl border px-3 pb-3 pt-4 sm:px-4"
                style={
                  {
                    '--row-accent': ROW_ACCENT.vip,
                    borderColor: tint(ROW_ACCENT.vip, 0.15),
                    background: `linear-gradient(135deg, ${tint(ROW_ACCENT.vip, 0.12)} 0%, rgba(21,25,38,0.4) 45%, transparent 100%)`,
                  } as React.CSSProperties
                }
              >
                <div className="mb-3.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="rail-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                      style={{ color: ROW_ACCENT.vip }}
                      aria-hidden
                    >
                      <Film className="h-5 w-5" />
                    </span>
                    <h2 className="truncate text-[17px] font-extrabold tracking-tight sm:text-2xl">
                      {t.navMovies}
                    </h2>
                  </div>
                  {oneOffMovies.length > 1 && (
                    <button
                      onClick={() => setViewAll({ title: t.navMovies, shows: oneOffMovies, movies: true })}
                      className="group/viewall flex shrink-0 items-center gap-0.5 rounded-full py-1 pl-2.5 pr-1.5 text-[11px] font-semibold text-[#9AA4BD] transition hover:bg-white/5 hover:text-white"
                    >
                      {t.viewAll}
                      <ChevronRight className="h-3.5 w-3.5 transition group-hover/viewall:translate-x-0.5" />
                    </button>
                  )}
                </div>
                <MovieCard show={featuredMovie} onClick={onSelectShow} />
              </section>
            )}
            {recommended.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="guide"
                icon={<Star className="h-5 w-5" />}
                title={t.recommendedForYou ?? 'Recommended for You'}
                shows={recommended}
                onSelectShow={onSelectShow}
              />
            )}
            <RailRow
              episodeNumbers={episodeNumbers}
              role="mark"
              icon={
                <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  <ClapperIcon className="h-5 w-5" />
                  <span
                    className="absolute -right-1 -top-1 h-2 w-2 animate-badge-pop rounded-full bg-current ring-2 ring-[#0A101E]"
                    aria-hidden
                  />
                </span>
              }
              title={t.newRelease}
              shows={newReleases}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.allShowsTitle, shows })}
              viewAllLabel={t.viewAll}
              tag={{ label: t.newTag ?? 'NEW', tone: 'mark' }}
            />
            <RailRow
              episodeNumbers={episodeNumbers}
              role="mark"
              icon={<Flame className="h-5 w-5" />}
              title={t.popularSeason}
              shows={shows.slice(0, 10)}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.allShowsTitle, shows })}
              viewAllLabel={t.viewAll}
              tag={{ label: t.hotTag ?? 'HOT', tone: 'mark' }}
            />

            {bingeShows.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="guide"
                icon={<ListVideo className="h-5 w-5" />}
                title={t.bingeRowLabel}
                shows={bingeShows}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.bingeRowLabel, shows: bingeShows })}
                viewAllLabel={t.viewAll}
              />
            )}
            {ongoingShows.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="mark"
                icon={<Radio className="h-5 w-5" />}
                title={t.ongoingRowLabel}
                shows={ongoingShows}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.ongoingRowLabel, shows: ongoingShows })}
                viewAllLabel={t.viewAll}
              />
            )}

            {genres.map((g) => {
              const list = showsByGenre(g.slug);
              if (list.length === 0) return null;
              return (
                <RailRow
                  key={g.id}
                  episodeNumbers={episodeNumbers}
                  emoji={genreEmoji(g.slug)}
                  title={g.name}
                  shows={list}
                  onSelectShow={onSelectShow}
                  onViewAll={() => setViewAll({ title: t.allShowsTitle ?? g.name, shows })}
                  viewAllLabel={t.viewAll}
                />
              );
            })}

            {/* One row per multi-season series, under a single section
                heading. A shared rail put "ប្រហារព្រះ រដូវកាល 1" and
                "រដូវកាល 2" next to each other under the same truncated
                title, which read as the same card twice; giving each
                series its own row makes the seasons obviously belong to
                one show and puts them in watch order. */}
            {franchises.length > 0 && (
              <section className="rail-section mt-8" style={{ '--row-accent': ROW_ACCENT.guide } as React.CSSProperties}>
                <div className="mb-3.5 flex items-center gap-2.5">
                  <span
                    className="rail-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                    style={{ color: ROW_ACCENT.guide }}
                    aria-hidden
                  >
                    <Layers className="h-5 w-5" />
                  </span>
                  <h2 className="truncate text-[17px] font-extrabold tracking-tight sm:text-2xl">
                    {t.seasonsRowLabel}
                  </h2>
                </div>
                {franchises.map((f) => (
                  <RailRow
                    key={f.base}
                    subRow
                    episodeNumbers={episodeNumbers}
                    title={f.base}
                    tag={{ label: `${f.entries.length} ${t.seasonsCountLabel}`, tone: 'info' }}
                    shows={f.entries.map((e) => e.show)}
                    seasons={Object.fromEntries(
                      f.entries.map((e) => [e.show.id, { season: e.season, base: f.base }]),
                    )}
                    onSelectShow={onSelectShow}
                  />
                ))}
              </section>
            )}

            {/* Coming Soon moved to the bottom of the browse list — it's
                not-yet-watchable content, so it now sits after everything
                that's actually playable instead of competing for the top
                of the page. */}
            {comingSoon.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="mark"
                icon={<Clock className="h-5 w-5" />}
                title={t.comingSoonLabel}
                shows={comingSoon}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.comingSoonLabel, shows: comingSoon })}
                viewAllLabel={t.viewAll}
                tag={{ label: t.freshTag ?? 'SOON', tone: 'mark' }}
              />
            )}

            {/* Rewards entry — language + VIP subscribe moved to Account
                screen per the person's request; this bar now only surfaces
                the bonus-spin badge when one is actually available. */}
            {rewardsAvailable && (
              <div className="mx-auto mt-10 flex max-w-[1400px] items-center justify-center pb-1 pt-3">
                <button
                  onClick={onOpenRewards}
                  aria-label={t.rewardsBadge}
                  title={t.rewardsBadge}
                  className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#F5C563]/30 bg-gradient-to-br from-[#F5C563]/20 to-[#B98430]/10 text-[#F5C563] backdrop-blur-md transition hover:scale-105 hover:bg-[#F5C563]/25 animate-badge-pop"
                >
                  <span className="absolute inset-0 rounded-full animate-glow-pulse" aria-hidden />
                  <Gift className="h-4 w-4" />
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#FF6B60] ring-2 ring-[#0A101E]" aria-hidden />
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="relative z-10 flex flex-col items-center gap-2 border-t border-white/5 px-4 pb-24 pt-8 text-center text-xs text-[#6A7591] sm:px-8 sm:pb-8">
        <span>{t.footerTagline}</span>
        {onOpenLegal && (
          <button onClick={onOpenLegal} className="underline decoration-white/20 underline-offset-2 transition hover:text-[#9AA4BD]">
            {t.legalLink ?? 'Terms & Privacy'}
          </button>
        )}
        <CreatorCredit />
      </footer>

      {/* Full-screen search overlay (mobile) */}
      {searchOpen && (
        <div className="fixed inset-0 z-[60] bg-app md:hidden">
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
            <Search className="h-5 w-5 text-[#6A7591]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="flex-1 bg-transparent text-base text-white placeholder-white/40 outline-none"
            />
            <button
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
              className="rounded-full p-1.5 text-[#9AA4BD] transition hover:text-white"
              aria-label="Close search"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-[calc(100%-65px)] overflow-y-auto px-4 py-4">
            {query.trim() ? (
              filteredShows.length === 0 ? (
                <p className="py-20 text-center text-[#6A7591]">{t.noResults}</p>
              ) : (
                <div className="grid grid-cols-3 gap-x-3 gap-y-5">
                  {filteredShows.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSearchOpen(false);
                        setQuery('');
                        onSelectShow(s);
                      }}
                      className="text-left"
                    >
                      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-[#151926] ring-1 ring-white/5">
                        <img
                          src={s.poster_url ?? ''}
                          alt={s.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <h3 className="mt-1.5 truncate text-xs font-semibold text-white">
                        {s.title}
                      </h3>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <Search className="h-10 w-10 text-white/20" />
                <p className="text-sm text-[#6A7591]">{t.searchHint}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom tab bar — mobile only (desktop keeps everything in the top
          header nav). Home / Series / Movies mirror the same top-nav
          actions; My List and Account leave this screen entirely, same as
          their header-nav counterparts always did. */}
      <BottomNav
        t={t}
        active={
          searchOpen
            ? 'search'
            : viewAll?.title === t.navSeries
              ? 'series'
              : viewAll?.title === t.navMovies
                ? 'movies'
                : !viewAll && !query.trim()
                  ? 'home'
                  : null
        }
        onHome={() => {
          setActiveTab('home');
          setQuery('');
          setViewAll(null);
          setSearchOpen(false);
        }}
        onSearch={() => setSearchOpen(true)}
        onSeries={() => {
          setQuery('');
          setViewAll({ title: t.navSeries, shows: shows.filter((s) => s.type === 'series') });
        }}
        onMovies={() => {
          setQuery('');
          setViewAll({ title: t.navMovies, shows: shows.filter((s) => s.type === 'movie'), movies: true });
        }}
        onMyList={onOpenWatchlist}
        onAccount={onOpenProfile}
        hasHistory={continueItems.length > 0}
      />
    </div>
  );
}

/* ---------- Coverflow hero ---------- */

type TranslationText = {
  featured: string;
  play: string;
  movie: string;
  series: string;
  freeBadge: string;
  movieOneOff: string;
  top10Label?: string;
  featuredLabel?: string;
  vipBadge?: string;
  ongoing?: string;
  comingSoonLabel: string;
  myList: string;
};

interface CoverflowHeroProps {
  shows: Show[];
  index: number;
  hero: Show;
  /** First genre name for the centered show, looked up from the
   *  genre-joined `shows` list — bannerShows itself has no genres. */
  heroGenre?: string;
  /** 1-based Top 10 (by real view count) rank, when the centered show is
   *  currently in the top 10 — undefined otherwise, which hides the
   *  ranked-numeral treatment entirely. */
  heroRank?: number;
  heroIsFree: boolean;
  heroIsMovie: boolean;
  onSelectShow: (s: Show) => void;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (i: number) => void;
  onTouchStart: (x: number) => void;
  onTouchEnd: (x: number) => void;
  t: TranslationText;
}

function CoverflowHero({
  shows,
  index,
  hero,
  heroGenre,
  heroRank,
  heroIsFree,
  heroIsMovie,
  onSelectShow,
  onPrev,
  onNext,
  onGoTo,
  onTouchStart,
  onTouchEnd,
  t,
}: CoverflowHeroProps) {
  const [bgLoaded, setBgLoaded] = useState(false);
  const ambienceRef = useRef<HTMLDivElement>(null);
  const [inList, setInList] = useState(() => isInWatchlist(hero.id));
  const bg = hero.banner_url ?? hero.poster_url ?? '';

  // Reset the loaded flag and re-check watchlist status whenever the
  // centered show changes (auto-advance or swipe).
  useEffect(() => {
    setBgLoaded(false);
    setInList(isInWatchlist(hero.id));
  }, [hero.id]);

  // Ambient background drifts a little slower than the page and fades out
  // as the viewer scrolls past the hero. This writes straight to the DOM
  // node inside a single rAF instead of storing scrollY in state: the old
  // version re-rendered the whole hero — including a `blur-3xl` poster,
  // which is one of the most expensive things a phone GPU can be asked to
  // repaint — on every scroll event, which is what made scrolling feel
  // like it was skidding. The drift is also gentler now (0.18 rather than
  // 0.35), so the backdrop never appears to outrun the finger.
  useEffect(() => {
    let ticking = false;
    const apply = () => {
      ticking = false;
      const el = ambienceRef.current;
      if (!el) return;
      const y = window.scrollY;
      const heroHeightPx = Math.min(window.innerHeight * 0.38, 360);
      el.style.transform = `translate3d(0, ${Math.min(y * 0.18, 80)}px, 0)`;
      el.style.opacity = String(Math.max(1 - y / heroHeightPx, 0));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(apply);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    apply();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The coverflow's viewing window — up to two posters tapered away on
  // each side of the centered one. Clamped to `shows.length` so a
  // catalogue with only one or two titles in rotation never has to render
  // the same card twice at two different offsets around the wrap.
  const range = [-2, -1, 0, 1, 2].filter((o) => Math.abs(o) < shows.length);
  const stage = range.map((offset) => {
    const i = (index + offset + shows.length) % shows.length;
    return { offset, i, show: shows[i] };
  });

  return (
    <section
      className="relative w-full overflow-hidden pb-5 pt-1 sm:pb-8 sm:pt-2"
      onTouchStart={(e) => onTouchStart(e.touches[0].clientX)}
      onTouchEnd={(e) => onTouchEnd(e.changedTouches[0].clientX)}
    >
      {/* Blurred ambient background driven by the centered show */}
      <div
        ref={ambienceRef}
        className="pointer-events-none absolute inset-0 will-change-transform"
      >
        {bg && (
          <img
            key={hero.id}
            src={bg}
            alt=""
            aria-hidden
            className={`hero-bg ${bgLoaded ? 'loaded' : ''} absolute inset-0 h-full w-full scale-125 object-cover blur-3xl`}
            onLoad={() => setBgLoaded(true)}
            // Decorative, and blurred past recognition — it must never
            // hold up the decode of the poster it sits behind.
            decoding="async"
            fetchPriority="low"
            draggable={false}
          />
        )}
        {/* Scrim over the blurred artwork. Deliberately lighter than a
            flat black wash: the blurred poster IS the colour source, so
            the ambience changes with every slide instead of every show
            looking identical. */}
        <div className="absolute inset-0 bg-black/45" />
        {/* Aurora — two soft blobs in the app's own two "you can act here"
            colours (brand blue, antique gold) drifting behind the stack.
            Positioned inside the hero, not `fixed`, so it scrolls away
            with it instead of forcing a full-viewport repaint per frame. */}
        <span
          className="aurora-blob left-[4%] top-0 h-40 w-40 sm:h-56 sm:w-56"
          style={{ background: 'radial-gradient(circle, rgba(78,134,255,0.35), transparent 70%)' }}
          aria-hidden
        />
        <span
          className="aurora-blob right-[6%] top-[6%] h-32 w-32 sm:h-48 sm:w-48"
          style={{ background: 'radial-gradient(circle, rgba(245,197,99,0.26), transparent 70%)', animationDelay: '2.4s' }}
          aria-hidden
        />
        {/* Fade the top into the header and the bottom into the page */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.5) 18%, rgba(0,0,0,0.06) 38%, rgba(0,0,0,0.18) 70%, rgba(0,0,0,0.85) 92%, rgba(0,0,0,1) 100%)',
          }}
        />
      </div>

      {/* Coverflow stack — the centered poster stands tall and square-on;
          up to two more taper away in 3D on each side, dimming a little
          further from center. Replaces the old poster-left/text-right
          banner: this is a real, tappable carousel rather than one static
          card with a strip of thumbnails bolted under it. */}
      <div className="relative z-10 mx-auto flex h-[224px] items-center justify-center px-4 sm:h-[300px] sm:px-8" style={{ perspective: '1400px' }}>
        {stage.map(({ offset, i, show }) => {
          const dist = Math.abs(offset);
          return (
            <button
              key={`${show.id}-${offset}`}
              onClick={() => (offset === 0 ? onSelectShow(show) : onGoTo(i))}
              aria-label={show.title}
              className={`hero-slide absolute ${offset === 0 ? 'hero-card-enter z-20' : ''}`}
              style={{
                width: 'clamp(106px, 30vw, 176px)',
                zIndex: 10 - dist,
                transform: `translateX(${offset * 68}%) translateZ(${-dist * 80}px) rotateY(${offset * -24}deg) scale(${1 - dist * 0.14})`,
                opacity: 1 - dist * 0.32,
              }}
            >
              <div
                className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl"
                style={{
                  boxShadow:
                    offset === 0
                      ? '0 26px 64px rgba(0,0,0,0.85), 0 8px 20px rgba(0,0,0,0.6)'
                      : '0 14px 34px rgba(0,0,0,0.6)',
                  filter: offset === 0 ? 'none' : `brightness(${1 - dist * 0.22}) saturate(${1 - dist * 0.25})`,
                }}
              >
                <div className="pointer-events-none absolute inset-0 z-10 rounded-2xl ring-1 ring-inset ring-white/12" />
                <img
                  src={show.poster_url ?? show.banner_url ?? ''}
                  alt={show.title}
                  // Only the centered poster is the largest thing above
                  // the fold — the tapered side cards can wait their turn.
                  fetchPriority={offset === 0 ? 'high' : 'low'}
                  decoding="async"
                  width={600}
                  height={900}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
                {offset === 0 && (
                  <>
                    <div
                      className="absolute inset-0"
                      style={{ background: 'linear-gradient(180deg, rgba(10,16,30,0) 62%, rgba(10,16,30,0.6) 100%)' }}
                    />
                    {/* Coming Soon — announced, but there is nothing to
                        play yet. Spelled out here rather than the icon the
                        rails use, since the hero has no row header above
                        it saying what it is. */}
                    {hero.coming_soon ? (
                      <Badge tone="mark" onArt icon={<Clock className="h-3 w-3" />} className="absolute left-1.5 top-1.5">
                        {t.comingSoonLabel}
                      </Badge>
                    ) : (
                      // Three answers, not two: a standalone film — bought
                      // once, not gated behind a membership — gets its own
                      // label rather than being lumped in with VIP. Same
                      // order ShowCard uses, so a title carries the same
                      // badge in the hero and in every rail.
                      <div className="absolute right-1.5 top-1.5">
                        {heroIsFree ? (
                          <Badge tone="free" onArt>
                            {t.freeBadge}
                          </Badge>
                        ) : heroIsMovie ? (
                          <Badge tone="price" onArt className="whitespace-nowrap">
                            {t.movieOneOff}
                          </Badge>
                        ) : (
                          <Badge tone="vip" onArt icon={<Crown className="h-3 w-3" />}>
                            {t.vipBadge ?? 'VIP'}
                          </Badge>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </button>
          );
        })}

        {/* Chevron arrows — desktop only, swipe/tap handles mobile.
            Anchored to the stage itself now, so they stay centered on the
            poster stack no matter how tall the caption below it grows. */}
        <button
          onClick={onPrev}
          className="absolute left-0 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-90 md:flex"
          aria-label="Previous"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          onClick={onNext}
          className="absolute right-0 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-90 md:flex"
          aria-label="Next"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Title + meta + actions — centered under the stack instead of
          wedged beside a single poster, so the whole hero reads as one
          composition anchored on the coverflow above it. */}
      <div className="relative z-10 mx-auto mt-4 max-w-[560px] px-6 text-center sm:mt-6">
        <span className="mb-1.5 flex flex-wrap items-center justify-center gap-1.5">
          <Badge tone="mark" icon={<Flame className="h-3 w-3" />} className="px-2 py-1 text-[11px]">
            {t.featuredLabel ?? 'កំពុងពេញនិយម'}
          </Badge>
          {heroRank && !hero.coming_soon && (
            <Badge tone="info" className="px-2 py-1 text-[11px]">
              TOP #{heroRank}
            </Badge>
          )}
        </span>
        <h2
          key={hero.id}
          onClick={() => onSelectShow(hero)}
          className="cursor-pointer text-xl font-black leading-[1.08] text-white sm:text-3xl"
          style={{
            fontFamily: '"Anton", Battambang, Inter, sans-serif',
            letterSpacing: '0.01em',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {hero.title}
        </h2>

        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] font-semibold text-white/70 sm:text-xs">
          <span className="flex items-center gap-1 text-[#F5C563]">
            <Star className="h-2.5 w-2.5 fill-[#F5C563] sm:h-3 sm:w-3" /> {Number(hero.rating).toFixed(1)}
          </span>
          {heroGenre && (
            <span className="flex items-center gap-x-2">
              <span className="h-3 w-px bg-white/20" aria-hidden />
              <span>{heroGenre}</span>
            </span>
          )}
          {hero.release_year && (
            <span className="flex items-center gap-x-2">
              <span className="h-3 w-px bg-white/20" aria-hidden />
              <span className="flex items-center gap-1">
                <Calendar className="h-2.5 w-2.5 sm:h-3 sm:w-3" /> {hero.release_year}
              </span>
            </span>
          )}
          <span className="rounded border border-white/20 px-1.5 py-0.5 text-[9.5px] font-medium uppercase text-white/70 sm:text-[11px]">
            {hero.type === 'movie' ? t.movie : t.series}
          </span>
          {/* "Ongoing" — same red pill as the Show Detail screen, so the
              cue reads consistently across the app. Red and not gold: it
              says the show is still getting episodes, which is
              information, not a premium promise — nothing red here is
              tappable. */}
          {hero.type === 'series' && hero.status !== 'completed' && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-accent sm:text-[11px]">
              {t.ongoing}
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 sm:mt-4 sm:gap-3">
          {/* Same tap either way — the detail screen is where a Coming
              Soon title explains itself — but the label stops saying
              "Play" for something that cannot be played yet. */}
          <button
            onClick={() => onSelectShow(hero)}
            className="flex items-center justify-center gap-1.5 rounded-full px-5 py-2 text-[12px] font-bold text-white shadow-[0_4px_16px_rgba(32,80,216,0.4)] transition active:scale-95 sm:px-7 sm:py-2.5 sm:text-sm"
            style={{ background: 'linear-gradient(135deg, #2050D8, #1A3FAE 55%, #0E2560)' }}
          >
            {hero.coming_soon ? (
              <>
                <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> {t.comingSoonLabel}
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-white sm:h-3.5 sm:w-3.5" /> {t.play}
              </>
            )}
          </button>
          <button
            onClick={() => {
              const now = toggleWatchlist(hero);
              setInList(now);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-full border px-5 py-2 text-[12px] font-bold transition active:scale-95 sm:px-7 sm:py-2.5 sm:text-sm ${
              inList
                ? 'border-white/30 bg-white/[0.12] text-white'
                : 'border-white/15 bg-white/[0.06] text-white/85 hover:bg-white/10'
            }`}
          >
            {inList ? <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> : <Plus className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
            {t.myList}
          </button>
        </div>

        {/* Thin auto-play countdown bar — fills up over each slide's
            dwell time, doubling as the position indicator. Keyed on the
            index so it restarts cleanly every time the centered show
            changes, whether from the timer or a manual swipe/tap. Not
            blue: blue in this app means "press me", and a countdown bar
            is the one thing here that cannot be pressed. */}
        {shows.length > 1 && (
          <div className="mx-auto mt-4 h-[3px] w-[120px] overflow-hidden rounded-full bg-white/10 sm:mt-5">
            <div
              key={index}
              className="hero-progress-fill h-full"
              style={{
                animationDuration: `${HERO_AUTO_MS}ms`,
                background: 'rgba(255,255,255,0.75)',
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------- Bottom tab bar (mobile) ---------- */

interface BottomNavProps {
  t: { navHome: string; navSearch: string; navSeries: string; navMovies: string; navMyList: string; navAccount: string };
  active: 'home' | 'search' | 'series' | 'movies' | null;
  onHome: () => void;
  onSearch: () => void;
  onSeries: () => void;
  onMovies: () => void;
  onMyList: () => void;
  onAccount: () => void;
  /** Highlights the "មើលបន្ត" tab when there's watch history to resume —
   *  see NavLink's `highlight` for the same idea on the desktop nav. */
  hasHistory?: boolean;
}

function BottomNav({ t, active, onHome, onSearch, onSeries, onMovies, onMyList, onAccount, hasHistory }: BottomNavProps) {
  return (
    // A floating dock inset from the bottom edge instead of a bar welded
    // flush to it — the same "chrome floats over content" language the
    // header capsule now uses. `bottom` plus a safe-area margin keeps it
    // clear of the home indicator on notched phones without needing the
    // inset baked into the bar's own height.
    <nav
      className="fixed inset-x-3 bottom-3 z-40 rounded-[26px] border border-white/10 bg-black/70 shadow-[0_14px_38px_rgba(0,0,0,0.5)] backdrop-blur-2xl sm:hidden"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-auto flex max-w-[560px] items-stretch justify-between gap-0.5 px-1.5 py-1.5">
        <BottomNavItem icon={<Home className="h-5 w-5" />} label={t.navHome} active={active === 'home'} onClick={onHome} />
        <BottomNavItem icon={<Search className="h-5 w-5" />} label={t.navSearch} active={active === 'search'} onClick={onSearch} />
        <BottomNavItem icon={<Tv className="h-5 w-5" />} label={t.navSeries} active={active === 'series'} onClick={onSeries} />
        <BottomNavItem icon={<Film className="h-5 w-5" />} label={t.navMovies} active={active === 'movies'} onClick={onMovies} />
        <BottomNavItem icon={<Bookmark className="h-5 w-5" />} label={t.navMyList} active={false} onClick={onMyList} highlight={hasHistory} />
        <BottomNavItem icon={<User className="h-5 w-5" />} label={t.navAccount} active={false} onClick={onAccount} />
      </div>
    </nav>
  );
}

interface BottomNavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  highlight?: boolean;
}

function BottomNavItem({ icon, label, active, onClick, highlight }: BottomNavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-1 flex-col items-center gap-1 rounded-[19px] py-2 transition ${
        active ? 'text-white' : highlight ? 'text-[#4E86FF]' : 'text-[#9AA4BD] active:text-white/80'
      }`}
    >
      {/* Filled capsule marks "you are here" now, instead of a thin top
          line — the same solid-pill language the desktop nav's active
          link uses, so mobile and desktop read as one idea. */}
      {active && (
        <span
          className="dock-active pointer-events-none absolute inset-1 rounded-[16px]"
          style={{
            background: 'linear-gradient(135deg, rgba(32,80,216,0.9) 0%, rgba(14,37,96,0.9) 100%)',
            boxShadow: '0 0 0 1px rgba(78,134,255,0.4) inset, 0 6px 16px rgba(32,80,216,0.4)',
          }}
          aria-hidden
        />
      )}
      <span className="relative">
        {icon}
        {highlight && !active && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#4E86FF] shadow-[0_0_6px_rgba(78,134,255,0.9)]" aria-hidden />
        )}
      </span>
      <span className={`relative max-w-full truncate px-0.5 text-[9.5px] leading-none ${highlight && !active ? 'font-bold' : 'font-semibold'}`}>{label}</span>
    </button>
  );
}

interface NavLinkProps {
  label: string;
  active: boolean;
  onClick: () => void;
  /** Lit up in the accent color with a small dot when there's watch
   *  history to resume — the "មើលបន្ត" link otherwise looks identical
   *  whether or not there's anything worth going back for. */
  highlight?: boolean;
}

function NavLink({ label, active, onClick, highlight }: NavLinkProps) {
  return (
    <button
      onClick={onClick}
      className={`relative shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] transition sm:text-sm ${
        active
          ? 'font-display font-bold tracking-wide text-white'
          : highlight
            ? 'font-bold text-[#4E86FF] hover:bg-white/5'
            : 'font-semibold text-white/50 hover:bg-white/5 hover:text-white/80'
      }`}
      // Filled pill instead of an underline — "here" is now a solid
      // capsule everywhere in the app's own navigation, top bar and
      // bottom dock alike.
      style={
        active
          ? {
              background: 'linear-gradient(135deg, rgba(32,80,216,0.92) 0%, rgba(14,37,96,0.92) 100%)',
              boxShadow: '0 4px 14px rgba(32,80,216,0.35)',
            }
          : undefined
      }
    >
      {label}
      {highlight && !active && (
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#4E86FF] shadow-[0_0_6px_rgba(78,134,255,0.9)]" aria-hidden />
      )}
    </button>
  );
}

/* ---------- Content rail row ---------- */

interface RailRowProps {
  title: string;
  /** A lucide icon at `h-5 w-5`, with NO colour class of its own — the
   *  row's role decides the colour, so an icon that arrives already
   *  painted is the exact drift this component exists to stop. */
  icon?: React.ReactNode;
  /** Optional decorative emoji shown instead of a lucide icon — used for
   *  genre rows so each one reads with a bit of its own personality. */
  emoji?: string;
  /** What this row IS, which is what decides its colour. See
   *  lib/rowAccent — rows pick a role, never a hex value. */
  role?: RowRole;
  shows: Show[];
  onSelectShow: (s: Show) => void;
  /** show id -> newest episode number, for each card's EP badge. */
  episodeNumbers?: Record<string, number>;
  onViewAll?: () => void;
  viewAllLabel?: string;
  /** Small colored tag chip shown next to the row title (e.g. NEW / HOT /
   *  FREE) — gives every row its own at-a-glance identity instead of a
   *  uniform plain heading. */
  tag?: { label: string; tone?: BadgeTone };
  /** Wraps the row in a slim gradient banner panel instead of the plain
   *  divider-line header — gives the row its own identity as a showcase
   *  strip rather than just another rail, without needing taller cards
   *  to read as "featured". Used for the Free and Movies rows. */
  panel?: boolean;
  /** Per-card season numbers, keyed by show id. Only the seasons row
   *  passes this — see ShowCard's `seasonNumber`. */
  seasons?: Record<string, { season: number; base: string }>;
  /** show id -> season number of the paid season that follows. */
  continuesAt?: Record<string, number>;
  /** A row nested under another heading: smaller title, no divider rule,
   *  tighter spacing. Used for the per-series season rows, which sit as a
   *  group under one "series with seasons" heading and would otherwise
   *  each shout as loudly as a top-level rail. */
  subRow?: boolean;
  /** Passed straight through to every card's `hideAccessBadge` — set this
   *  only for a row that's already homogeneous (every card the same free/
   *  VIP status), so the row's own heading carries that fact instead of
   *  every poster repeating it. */
  hideAccessBadge?: boolean;
}

function RailRow({
  title,
  icon,
  emoji,
  role = 'plain',
  shows,
  onSelectShow,
  episodeNumbers,
  onViewAll,
  viewAllLabel,
  tag,
  panel,
  seasons,
  subRow,
  continuesAt,
  hideAccessBadge,
}: RailRowProps) {
  const scrollerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollLeft = 0;
  }, []);
  const accent = ROW_ACCENT[role];

  return (
    <section
      // `rail-section` is what keeps a page of eleven rails scrolling at
      // frame rate: it lets the browser skip layout and paint for rows
      // that are nowhere near the viewport. `--row-accent` is read by
      // every ShowCard inside, so a card lights up in its own row's
      // colour rather than one hard-coded blue.
      className={`rail-section ${panel ? 'mt-8 overflow-hidden rounded-2xl border px-3 pb-1 pt-4 sm:px-4' : subRow ? 'mt-3' : 'mt-8'}`}
      style={
        {
          '--row-accent': accent,
          ...(panel
            ? {
                borderColor: tint(accent, 0.15),
                // A wash of the row's own accent rather than a flat card:
                // enough to separate the strip from the page, not enough to
                // compete with the poster art sitting on it.
                background: `linear-gradient(135deg, ${tint(accent, 0.12)} 0%, rgba(21,25,38,0.4) 45%, transparent 100%)`,
              }
            : null),
        } as React.CSSProperties
      }
    >
      {/* Editorial header — an icon/emoji tile filled with a soft wash of
          the row's own accent (`.rail-chip`, reading `--row-accent` from
          this section) stands in for the old thin left bar + full-width
          fading hairline. It carries the same "which of the five roles is
          this row" signal DESIGN_SYSTEM.md defines, just as one solid
          anchor instead of a line stretched across the whole row. A
          sub-row sits inside an already-titled section, so it skips the
          chip and stays a plain small heading. */}
      <div className={`flex items-center justify-between gap-2 ${subRow ? 'mb-2 pl-1' : 'mb-3.5'}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          {!subRow && (icon || emoji) && (
            <span
              className="rail-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base"
              style={{ color: accent }}
              aria-hidden
            >
              {icon ?? emoji}
            </span>
          )}
          {subRow && (icon || emoji) && (
            <span className="flex shrink-0 items-center text-sm" style={{ color: accent }} aria-hidden>
              {icon ?? emoji}
            </span>
          )}
          {subRow ? (
            <h3 className="truncate text-[13px] font-bold text-white/90">{title}</h3>
          ) : (
            <h2 className="truncate text-[17px] font-extrabold tracking-tight sm:text-2xl">
              {title}
            </h2>
          )}
          {tag && <Badge tone={tag.tone ?? 'info'}>{tag.label}</Badge>}
        </div>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="group/viewall flex shrink-0 items-center gap-0.5 rounded-full py-1 pl-2.5 pr-1.5 text-[11px] font-semibold text-[#9AA4BD] transition hover:bg-white/5 hover:text-white"
          >
            {viewAllLabel}
            <ChevronRight className="h-3.5 w-3.5 transition group-hover/viewall:translate-x-0.5" />
          </button>
        )}
      </div>
      <div ref={scrollerRef} className="rail-scroller no-scrollbar flex gap-3 overflow-x-auto pb-3">
        {shows.map((s) => (
          <ShowCard
            key={s.id}
            show={s}
            onClick={onSelectShow}
            latestEpisode={episodeNumbers?.[s.id]}
            seasonNumber={seasons?.[s.id]?.season}
            displayTitle={seasons?.[s.id]?.base}
            titleFromSeason={subRow}
            continuesAtSeason={continuesAt?.[s.id]}
            hideAccessBadge={hideAccessBadge}
          />
        ))}
      </div>
    </section>
  );
}
