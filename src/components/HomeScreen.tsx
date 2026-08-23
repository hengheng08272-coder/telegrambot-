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
  Calendar,
} from 'lucide-react';
import type { Show, ShowWithGenres, Genre } from '@/lib/types';
import { fetchAllShows, fetchGenres, fetchTickerMessage, fetchShowEpisodeInfo, type ShowEpisodeInfo } from '@/lib/api';
import ShowCard from '@/components/ShowCard';
import MovieCard from '@/components/MovieCard';
import SupporterTicker from '@/components/SupporterTicker';
import CreatorCredit from '@/components/CreatorCredit';
import NotificationBell from '@/components/NotificationBell';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import { usePresenceCount } from '@/lib/presence';
import { getCurrentTelegramProfile } from '@/lib/telegram';
import { toggleWatchlist, isInWatchlist, getContinueWatching, type ContinueItem } from '@/lib/watchlist';

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

// "12345" -> "12.3K", "2100000" -> "2.1M" — used for the hero's view count.
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
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
  const watchingNow = usePresenceCount();
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
        setError(e instanceof Error ? e.message : 'Failed to load content');
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
          <p className="mt-2 text-sm text-[#B7C0D4]">{error}</p>
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

      {/* Header v5 — three loose zones instead of five separate bordered
          pills. Identity (avatar + live count) and utility (search / bell
          / VIP) now read as clusters separated by whitespace and one
          hairline divider, not individually boxed — the "glass pill"
          treatment is reserved for the one place status actually needs to
          be seen: the avatar's own ring/glow. VIP status no longer says
          itself twice, either: a subscriber already wears the crown on
          their avatar, so the header button quiets to a plain icon once
          subscribed instead of repeating "Premium" a second time — the
          gold CTA stays loud only for the person it's still trying to
          convert. */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
          heroVisible && !scrolled ? 'bg-transparent' : 'bar-blur'
        }`}
      >
        {/* Signature edge — a thin red broadcast line instead of the
            generic neutral hairline most app headers default to. Only
            appears once the bar goes solid, so it never competes with the
            hero art underneath. */}
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#E6231F]/50 to-transparent transition-opacity duration-300 ${
            heroVisible && !scrolled ? 'opacity-0' : 'opacity-100'
          }`}
          aria-hidden
        />
        <div className="no-scrollbar mx-auto flex max-w-[1400px] flex-nowrap items-center gap-3 overflow-x-auto px-2.5 py-2.5 sm:gap-5 sm:px-8 sm:py-3">
          {/* Identity — avatar + username, borderless at rest. The
              Telegram app-icon button that used to sit here was removed
              earlier: Telegram already prints "NINTANIME mini app" above,
              so it was a third piece of branding pushing the person's own
              name off-screen on narrow phones. */}
          <button
            onClick={onOpenProfile}
            aria-label={t.navAccount}
            className="flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-1 transition hover:bg-white/[0.04] sm:gap-2"
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
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-glow-pulse rounded-full bg-[#FF6B7C] ring-2 ring-[#0A101E]"
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

          {/* Live "watching now" count — a real Realtime Presence tally
              (see src/lib/presence.ts), sitting inline now with no border
              of its own. Dot + number always show; the "watching now"
              label only renders from `md:` up, past every phone's CSS
              viewport width. */}
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E6231F]/70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#E6231F]" />
            </span>
            <span className="font-display text-xs font-bold text-white sm:text-sm">{watchingNow.toLocaleString()}</span>
            <span className="whitespace-nowrap text-[10px] text-[#A3ADC4] sm:text-xs">{t.watchingNow ?? 'watching now'}</span>
          </div>

          {/* Divider — marks where "browse" ends and personal/account
              utility begins. One hairline does this instead of boxing
              every control that follows it. */}
          <span className="hidden h-5 w-px shrink-0 bg-white/10 sm:block" aria-hidden />

          {/* Nav links — scrolls horizontally instead of wrapping/breaking
              on the narrowest phones, but fits on one line on anything
              typical. */}
          <nav className="no-scrollbar hidden min-w-0 flex-1 items-center gap-5 overflow-x-auto sm:flex">
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
            <NavLink label={t.navMyList} active={false} onClick={onOpenWatchlist} />
          </nav>

          {/* Search — icon button opens the full-screen overlay below
              `sm:`; an inline expanding box from `sm:` up. */}
          <button
            onClick={() => setSearchOpen(true)}
            aria-label={t.navSearch}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/5 hover:text-white sm:hidden"
          >
            <Search className="h-4 w-4" />
          </button>
          <div className="relative hidden shrink-0 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A93AC]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-44 rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none transition focus:w-60 focus:border-[#E6231F]/50 focus:bg-white/[0.07]"
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
                : 'flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[10px] font-black text-white transition active:scale-95 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs'
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
      <div className="relative z-10 pt-[52px] sm:pt-[60px]">
        <SupporterTicker
          staticMessage={tickerMessage}
        />

        {/* Coverflow hero carousel */}
        {heroVisible && (
          <CoverflowHero
            shows={bannerShows}
            index={heroIndex}
            hero={hero}
            heroGenre={showsById.get(hero.id)?.genres?.[0]?.name}
            heroRank={trendingRank.get(hero.id)}
            heroIsFree={showsById.get(hero.id)?.is_free ?? hero.is_free ?? false}
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
              <p className="py-20 text-center text-[#8A93AC]">{t.noResults}</p>
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
              <span className="text-[#8A93AC]">({filteredShows.length})</span>
            </h2>
            {filteredShows.length === 0 ? (
              <p className="py-20 text-center text-[#8A93AC]">{t.noResults}</p>
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
            {/* The ranked/numeral "Top 10" rail was removed per request —
                the featured carousel above already surfaces what's trending
                without repeating it as a second ranked row underneath. */}
            {/* "Continue Watching" replaces the old "Now Airing" row here —
                members who left a show mid-episode get it surfaced right
                at the top of home, easy to find and resume, instead of
                having to dig for it in My List. */}
            {continueItems.length > 0 ? (
              <ContinueWatchingRow
                items={continueItems}
                onResume={onResumeEpisode}
                title={t.continueWatching}
                epLabel={t.epShort}
              />
            ) : (
              trending[0] && (
                <StartWatchingPrompt
                  show={trending[0]}
                  title={t.continueWatching}
                  message={t.continueEmpty}
                  cta={t.startWatching ?? 'Start Watching'}
                  onSelectShow={onSelectShow}
                />
              )
            )}
            {recommended.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                icon={<Star className="h-5 w-5 text-[#F5C563]" />}
                title={t.recommendedForYou ?? 'Recommended for You'}
                shows={recommended}
                onSelectShow={onSelectShow}
              />
            )}
            {freeShows.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                icon={<Gift className="h-5 w-5 text-[#2FD98C]" />}
                title={t.freeRowLabel ?? 'Free to Watch'}
                shows={freeShows}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.freeRowLabel ?? 'Free to Watch', shows: freeShows })}
                viewAllLabel={t.viewAll}
                tag={{ label: t.freeBadge, color: '#2FD98C' }}
              />
            )}
            <RailRow
              episodeNumbers={episodeNumbers}
              icon={
                <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center text-[#E6231F]">
                  <ClapperIcon className="h-5 w-5" />
                  <span className="absolute -right-1 -top-1 h-2 w-2 animate-badge-pop rounded-full bg-[#E6231F] ring-2 ring-[#0A101E]" aria-hidden />
                </span>
              }
              title={t.newRelease}
              shows={newReleases}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.allShowsTitle, shows })}
              viewAllLabel={t.viewAll}
              tag={{ label: t.newTag ?? 'NEW', color: '#EDEDF0' }}
            />
            <RailRow
              episodeNumbers={episodeNumbers}
              icon={<Flame className="h-5 w-5 text-[#E6231F]" />}
              title={t.popularSeason}
              shows={shows.slice(0, 10)}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.allShowsTitle, shows })}
              viewAllLabel={t.viewAll}
              tag={{ label: t.hotTag ?? 'HOT', color: '#E6231F' }}
            />

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

            {/* Coming Soon moved to the bottom of the browse list — it's
                not-yet-watchable content, so it now sits after everything
                that's actually playable instead of competing for the top
                of the page. */}
            {comingSoon.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                icon={<Clock className="h-5 w-5 text-[#FF6B7C]" />}
                title={t.comingSoonLabel}
                shows={comingSoon}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.comingSoonLabel, shows: comingSoon })}
                viewAllLabel={t.viewAll}
                tag={{ label: t.freshTag ?? 'SOON', color: '#FF6B7C' }}
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
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#FF6B7C] ring-2 ring-[#0A101E]" aria-hidden />
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="relative z-10 flex flex-col items-center gap-2 border-t border-white/5 px-4 pb-24 pt-8 text-center text-xs text-[#6E7586] sm:px-8 sm:pb-8">
        <span>{t.footerTagline}</span>
        {onOpenLegal && (
          <button onClick={onOpenLegal} className="underline decoration-white/20 underline-offset-2 transition hover:text-[#B7C0D4]">
            {t.legalLink ?? 'Terms & Privacy'}
          </button>
        )}
        <CreatorCredit />
      </footer>

      {/* Full-screen search overlay (mobile) */}
      {searchOpen && (
        <div className="fixed inset-0 z-[60] bg-app md:hidden">
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
            <Search className="h-5 w-5 text-[#8A93AC]" />
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
              className="rounded-full p-1.5 text-[#B7C0D4] transition hover:text-white"
              aria-label="Close search"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-[calc(100%-65px)] overflow-y-auto px-4 py-4">
            {query.trim() ? (
              filteredShows.length === 0 ? (
                <p className="py-20 text-center text-[#8A93AC]">{t.noResults}</p>
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
                <p className="text-sm text-[#8A93AC]">{t.searchHint}</p>
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
      const heroHeightPx = Math.min(window.innerHeight * 0.32, 280);
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

  return (
    <section
      className="relative w-full overflow-hidden px-4 pb-4 pt-1 sm:px-8 sm:pb-5 sm:pt-2"
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
            draggable={false}
          />
        )}
        {/* Scrim over the blurred artwork. Deliberately lighter than a
            flat black wash: the blurred poster IS the colour source, so
            the ambience changes with every slide instead of every show
            looking identical. */}
        <div className="absolute inset-0 bg-black/45" />
        {/* Fade the top into the header and the bottom into the page */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.55) 16%, rgba(0,0,0,0.05) 36%, rgba(0,0,0,0.15) 70%, rgba(0,0,0,0.8) 90%, rgba(0,0,0,1) 100%)',
          }}
        />
      </div>

      {/* Horizontal cover — poster + Top 10 numeral on the left, title/
          meta/actions on the right. Sized down to read as a compact card
          (closer to Netflix's own Top 10 numeral treatment) rather than a
          large cinematic banner — smaller poster, smaller numeral,
          tighter text. */}
      <div className="relative z-10 mx-auto flex max-w-[1400px] items-center gap-3 pt-0 sm:gap-6 sm:pt-0">
        <button
          onClick={() => onSelectShow(hero)}
          aria-label={hero.title}
          className="hero-card-enter relative z-10 shrink-0"
          style={{ width: '32%', maxWidth: 152 }}
        >
          {/* Lantern-glow poster card — a warm double-ring frame (jade
              inner line, antique-gold outer glow) stands in for the old
              rank numeral. It reads as "the one worth lighting up" without
              pinning the hero's identity to a view-count rank. */}
          <div
            className="relative z-10 aspect-[2/3] w-full overflow-hidden rounded-xl transition-transform duration-500"
            style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.8), 0 6px 18px rgba(0,0,0,0.55)' }}
          >
            <div className="pointer-events-none absolute inset-0 z-10 rounded-xl ring-1 ring-inset ring-white/12" />
            <img
              src={hero.poster_url ?? hero.banner_url ?? ''}
              alt={hero.title}
              className="h-full w-full object-cover"
              draggable={false}
            />
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(180deg, rgba(10,16,30,0) 60%, rgba(10,16,30,0.6) 100%)' }}
            />
            {/* Coming Soon — announced, but there is nothing to play yet.
                It takes the whole top of the cover: a title in the Top 10
                that cannot be watched is the one thing a viewer has to
                know before tapping. Spelled out here rather than the
                icon the rails use, since the hero has no row header above
                it saying what it is. */}
            {hero.coming_soon ? (
              <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-[#E6231F]/90 px-1.5 py-0.5 text-[9px] font-black text-white backdrop-blur-sm">
                <Clock className="h-2.5 w-2.5" /> {t.comingSoonLabel}
              </span>
            ) : (
              <>
                {/* Trending tag — a small corner flag instead of a numeral,
                    only shown when the show is genuinely trending. */}
                {heroRank && (
                  <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-black text-white backdrop-blur-sm">
                    <span className="animate-pulse">🔥</span> TOP #{heroRank}
                  </span>
                )}
                {/* VIP / Free badge — same subscription status the detail
                    screen enforces, so the cover never over-promises.
                    Skipped on a Coming Soon cover, where neither label
                    means anything until episodes exist. */}
                <div className="absolute right-1.5 top-1.5">
                  {heroIsFree ? (
                    <span className="rounded-md bg-emerald-500/85 px-1.5 py-0.5 text-[8px] font-bold text-white backdrop-blur-sm">
                      {t.freeBadge}
                    </span>
                  ) : (
                    <span
                      className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[8px] font-black text-black backdrop-blur-sm"
                      style={{ background: 'linear-gradient(135deg, #FFE7B0, #F5C563 45%, #C08F33)' }}
                    >
                      👑 {t.vipBadge ?? 'VIP'}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </button>

        {/* Title + meta + actions */}
        <div className="min-w-0 flex-1 text-left">
          <span
            className="relative -top-1 mb-1 inline-flex items-center gap-1 rounded-md border border-[#E6231F]/40 bg-[#E6231F]/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[#FF6B7C] sm:text-[11px]"
            style={{ fontFamily: '"Anton", Battambang, sans-serif', letterSpacing: '0.06em' }}
          >
            <span className="animate-pulse">🔥</span> {t.featuredLabel ?? 'កំពុងពេញនិយម'}
          </span>
          <h2
            key={hero.id}
            onClick={() => onSelectShow(hero)}
            className="cursor-pointer text-xl font-black leading-[1.05] text-white sm:text-3xl"
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

          {heroGenre && (
            <p className="mt-0.5 truncate text-[11px] font-semibold text-[#A3ADC4] sm:text-xs">{heroGenre}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold text-white/70 sm:text-xs">
            <span className="flex items-center gap-1 text-[#F5C563]">
              <Star className="h-2.5 w-2.5 fill-[#F5C563] sm:h-3 sm:w-3" /> {Number(hero.rating).toFixed(1)}
            </span>
            {hero.release_year && (
              <>
                <span className="h-3 w-px bg-white/20" aria-hidden />
                <span className="flex items-center gap-1">
                  <Calendar className="h-2.5 w-2.5 sm:h-3 sm:w-3" /> {hero.release_year}
                </span>
              </>
            )}
            <span className="h-3 w-px bg-white/20" aria-hidden />
            <span className="rounded border border-white/20 px-1.5 py-0.5 text-[9px] font-medium uppercase text-white/70 sm:text-[10px]">
              {hero.type === 'movie' ? t.movie : t.series}
            </span>
            {/* "Ongoing" — same steel-blue pill as the Show Detail
                screen, so the cue reads consistently across the app
                instead of inventing a separate style just for the hero.
                Steel and not gold: it says the show is still getting
                episodes, which is information, not a premium promise. */}
            {hero.type === 'series' && hero.status !== 'completed' && (
              <>
                <span className="h-3 w-px bg-white/20" aria-hidden />
                <span className="rounded bg-steel/15 px-1.5 py-0.5 text-[9px] font-semibold text-steel sm:text-[10px]">
                  {t.ongoing}
                </span>
              </>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 sm:mt-3.5 sm:gap-2.5">
            {/* Same tap either way — the detail screen is where a Coming
                Soon title explains itself — but the label stops saying
                "Play" for something that cannot be played yet. */}
            <button
              onClick={() => onSelectShow(hero)}
              className="flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[11px] font-bold text-white shadow-[0_4px_16px_rgba(230,35,31,0.4)] transition active:scale-95 sm:px-5 sm:py-2 sm:text-xs"
              style={{ background: 'linear-gradient(135deg, #E6231F, #E6231F 55%, #8F1020)' }}
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
              className={`flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-[11px] font-bold transition active:scale-95 sm:px-5 sm:py-2 sm:text-xs ${
                inList
                  ? 'border-white/30 bg-white/[0.12] text-white'
                  : 'border-white/15 bg-white/[0.06] text-white/85 hover:bg-white/10'
              }`}
            >
              {inList ? <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> : <Plus className="h-3 w-3 sm:h-3.5 sm:w-3.5" />}
              {t.myList}
            </button>
          </div>
        </div>
      </div>

      {/* Mini-poster strip — the other trending shows as small tappable
          thumbnails right under the featured card, so the hero reads as
          a real browsable carousel instead of a single static banner.
          The centered show gets a lit ring; everything else sits at
          reduced opacity until tapped. */}
      {shows.length > 1 && (
        <div className="relative z-10 mx-auto mt-3 flex max-w-[1400px] gap-2 overflow-x-auto px-0.5 pb-1 sm:mt-4 sm:gap-2.5" style={{ scrollbarWidth: 'none' }}>
          {shows.map((s, i) => (
            <button
              key={s.id}
              onClick={() => onGoTo(i)}
              aria-label={s.title}
              className="shrink-0 overflow-hidden rounded-lg transition-all duration-300"
              style={{
                width: 52,
                aspectRatio: '2 / 3',
                opacity: i === index ? 1 : 0.4,
                boxShadow: i === index ? '0 0 0 2px rgba(255,255,255,0.9)' : 'none',
                transform: i === index ? 'translateY(-3px)' : 'none',
              }}
            >
              <img
                src={s.poster_url ?? s.banner_url ?? ''}
                alt={s.title}
                className="h-full w-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}

      {/* Chevron arrows — desktop only, swipe handles mobile. Anchored to
          the section edges now that there's no side-card deck to sit
          between. */}
      <button
        onClick={onPrev}
        className="absolute left-2 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-90 md:flex"
        aria-label="Previous"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        onClick={onNext}
        className="absolute right-2 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-90 md:flex"
        aria-label="Next"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

      {/* Thin auto-play countdown bar — fills up over each slide's dwell
          time, doubling as the position indicator. Keyed on the index so
          it restarts cleanly every time the centered show changes,
          whether from the timer or a manual swipe/tap. */}
      {shows.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 z-30 h-[3px] w-full overflow-hidden bg-white/10">
          <div
            key={index}
            className="hero-progress-fill h-full"
            style={{
              animationDuration: `${HERO_AUTO_MS}ms`,
              background: '#E6231F',
            }}
          />
        </div>
      )}
    </section>
  );
}

// Small, fixed set of rising ember sparks — purely decorative, positioned
// with a deterministic spread (not random on every render, so they don't
// jump around on re-render) and staggered delays/durations for a natural,
// non-uniform drift.
const EMBER_SEEDS = [
  { left: '8%', delay: '0s', duration: '4.2s', size: 3, drift: '10px' },
  { left: '18%', delay: '1.1s', duration: '5.1s', size: 2, drift: '-8px' },
  { left: '30%', delay: '2.4s', duration: '4.6s', size: 3, drift: '14px' },
  { left: '46%', delay: '0.6s', duration: '5.4s', size: 2, drift: '-12px' },
  { left: '58%', delay: '1.8s', duration: '4.8s', size: 3, drift: '8px' },
  { left: '70%', delay: '3s', duration: '5.2s', size: 2, drift: '-10px' },
  { left: '82%', delay: '0.9s', duration: '4.4s', size: 3, drift: '12px' },
  { left: '92%', delay: '2.1s', duration: '5s', size: 2, drift: '-9px' },
];

function EmberParticles() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {EMBER_SEEDS.map((e, i) => (
        <span
          key={i}
          className="ember-particle"
          style={
            {
              left: e.left,
              width: e.size,
              height: e.size,
              animationDelay: e.delay,
              animationDuration: e.duration,
              '--ember-drift': e.drift,
            } as React.CSSProperties & Record<string, string | number>
          }
        />
      ))}
    </div>
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
}

function BottomNav({ t, active, onHome, onSearch, onSeries, onMovies, onMyList, onAccount }: BottomNavProps) {
  return (
    // Welded to the bottom edge of the screen (not a floating pill): on a
    // phone the tab bar has to sit in the thumb's resting place, flush
    // with the home indicator, exactly like the previous home screen.
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-black/95 backdrop-blur-xl sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="mx-auto flex max-w-[560px] items-stretch justify-between px-1">
        <BottomNavItem icon={<Home className="h-5 w-5" />} label={t.navHome} active={active === 'home'} onClick={onHome} />
        <BottomNavItem icon={<Search className="h-5 w-5" />} label={t.navSearch} active={active === 'search'} onClick={onSearch} />
        <BottomNavItem icon={<Tv className="h-5 w-5" />} label={t.navSeries} active={active === 'series'} onClick={onSeries} />
        <BottomNavItem icon={<Film className="h-5 w-5" />} label={t.navMovies} active={active === 'movies'} onClick={onMovies} />
        <BottomNavItem icon={<Bookmark className="h-5 w-5" />} label={t.navMyList} active={false} onClick={onMyList} />
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
}

function BottomNavItem({ icon, label, active, onClick }: BottomNavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 transition ${
        active ? 'text-[#FF6B7C]' : 'text-[#9AA1B2] active:text-white/80'
      }`}
    >
      {active && (
        <span
          className="pointer-events-none absolute inset-x-4 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent via-[#E6231F] to-transparent"
          aria-hidden
        />
      )}
      {icon}
      <span className="max-w-full truncate px-0.5 text-[9px] font-semibold leading-none">{label}</span>
    </button>
  );
}

interface NavLinkProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavLink({ label, active, onClick }: NavLinkProps) {
  return (
    <button
      onClick={onClick}
      className={`relative shrink-0 whitespace-nowrap px-0.5 pb-2 pt-1 text-[11px] transition sm:text-sm ${
        active
          ? 'font-display font-bold tracking-wide text-white'
          : 'font-semibold text-white/50 hover:text-white/80'
      }`}
    >
      {label}
      {active && (
        <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-gradient-to-r from-[#FF6B7C] to-[#E6231F] shadow-[0_0_10px_rgba(230,35,31,0.8)]" />
      )}
    </button>
  );
}

/* ---------- Content rail row ---------- */

interface RailRowProps {
  title: string;
  icon?: React.ReactNode;
  /** Optional decorative emoji shown instead of a lucide icon — used for
   *  genre rows so each one reads with a bit of its own personality. */
  emoji?: string;
  shows: Show[];
  onSelectShow: (s: Show) => void;
  /** show id -> newest episode number, for each card's EP badge. */
  episodeNumbers?: Record<string, number>;
  onViewAll?: () => void;
  viewAllLabel?: string;
  /** When true, stamps each card with its 1-based position as a big
   *  shadow numeral behind the card — the "Top 10" treatment. Card size
   *  stays the same compact size as every other row; only the numeral is
   *  oversized. */
  ranked?: boolean;
  /** Small colored tag chip shown next to the row title (e.g. NEW / HOT /
   *  FREE) — echoes the "Row: <colored label>" treatment from the mockup,
   *  giving every row its own at-a-glance identity instead of a uniform
   *  plain heading. { label, color } — color is any CSS color value. */
  tag?: { label: string; color: string };
}

function RailRow({ title, icon, emoji, shows, onSelectShow, episodeNumbers, onViewAll, viewAllLabel, ranked, tag }: RailRowProps) {
  const scrollerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollLeft = 0;
  }, []);

  return (
    <section className={ranked ? 'relative mt-8 overflow-hidden rounded-xl' : 'mt-9'}>
      {!ranked && (
        <div
          className="mb-4 h-px w-full bg-gradient-to-r from-white/[0.14] via-white/[0.05] to-transparent"
          aria-hidden
        />
      )}
      {ranked ? (
        // Centered, Netflix-style row header — the "View All" link moves
        // to its own row underneath instead of crowding the centered
        // title on the same line.
        <div className="px-3 pt-5 text-center">
          <div className="mb-1 flex items-center justify-center gap-2">
            {icon ?? (emoji && <span className="text-base leading-none">{emoji}</span>)}
            <h2 className="text-xl font-black tracking-wide text-white">{title}</h2>
            {tag && (
              <span
                className="rounded-md px-2 py-[2px] text-[9px] font-black uppercase tracking-wider text-black"
                style={{ backgroundColor: tag.color }}
              >
                {tag.label}
              </span>
            )}
          </div>
          {onViewAll && (
            <button
              onClick={onViewAll}
              className="text-xs font-semibold text-[#A3ADC4] transition hover:text-[#E6231F]"
            >
              {viewAllLabel}
            </button>
          )}
        </div>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="h-4 w-[3px] shrink-0 rounded-sm"
              style={{ background: tag?.color ?? '#E6231F' }}
              aria-hidden
            />
            {icon ?? (emoji && <span className="text-base leading-none">{emoji}</span>)}
            <h2 className="truncate text-lg font-bold tracking-tight">{title}</h2>
            {tag && (
              <span
                className="rounded-md px-2 py-[2px] text-[9px] font-black uppercase tracking-wider text-black"
                style={{ backgroundColor: tag.color }}
              >
                {tag.label}
              </span>
            )}
          </div>
          {onViewAll && (
            <button
              onClick={onViewAll}
              className="shrink-0 text-xs font-semibold text-[#A3ADC4] transition hover:text-[#E6231F]"
            >
              {viewAllLabel}
            </button>
          )}
        </div>
      )}
      <div
        ref={scrollerRef}
        className={`no-scrollbar flex overflow-x-auto pb-3 ${ranked ? 'gap-5 px-3 pt-4' : 'gap-3'}`}
      >
        {shows.map((s, i) => (
          <ShowCard
            key={s.id}
            show={s}
            onClick={onSelectShow}
            latestEpisode={episodeNumbers?.[s.id]}
            rank={ranked ? i + 1 : undefined}
          />
        ))}
      </div>
    </section>
  );
}

/* ---------- Continue watching row ---------- */

interface ContinueWatchingRowProps {
  items: ContinueItem[];
  onResume: (show: Show, episodeId: string) => void;
  title: string;
  epLabel: string;
}

function ContinueWatchingRow({ items, onResume, title, epLabel }: ContinueWatchingRowProps) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-5 w-5 text-steel" />
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      </div>
      <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-3">
        {items.map((item) => (
          <button
            key={item.show.id}
            onClick={() => onResume(item.show, item.episode.id)}
            className="group relative w-[152px] shrink-0 text-left sm:w-[190px]"
          >
            <div className="relative aspect-video overflow-hidden rounded-xl bg-[#151926] ring-1 ring-white/5">
              <img
                src={item.episode.thumbnail_url ?? item.show.banner_url ?? item.show.poster_url ?? ''}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E6231F]/90 shadow-lg transition group-active:scale-90">
                  <Play className="h-3.5 w-3.5 fill-white text-white" />
                </div>
              </div>
              <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                {epLabel} {item.episode.episode_number}
              </span>
            </div>
            <h3 className="mt-1.5 truncate text-xs font-semibold text-white sm:text-sm">
              {item.show.title}
            </h3>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------- Continue watching — empty state ---------- */

interface StartWatchingPromptProps {
  show: Show;
  title: string;
  message: string;
  cta: string;
  onSelectShow: (s: Show) => void;
}

// Shown in place of the Continue Watching row for anyone with no watch
// history yet — same section header and shelf height as the row it
// replaces, so the page doesn't visibly jump once real history appears,
// but the content invites a first tap instead of just being blank.
function StartWatchingPrompt({ show, title, message, cta, onSelectShow }: StartWatchingPromptProps) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex items-center gap-2">
        <Clock className="h-5 w-5 text-steel" />
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      </div>
      <button
        onClick={() => onSelectShow(show)}
        className="group relative flex w-full items-center gap-4 overflow-hidden rounded-xl border border-dashed border-white/12 bg-white/[0.02] p-3 text-left transition hover:border-[#E6231F]/40 hover:bg-white/[0.04]"
      >
        <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-[#151926] ring-1 ring-white/5 sm:h-24 sm:w-16">
          <img
            src={show.poster_url ?? show.banner_url ?? ''}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white sm:text-base">{show.title}</p>
          <p className="mt-0.5 text-xs text-[#8A93AC] sm:text-sm">{message}</p>
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#E6231F] px-3 py-1.5 text-xs font-bold text-white shadow-[0_2px_10px_rgba(230,35,31,0.35)] transition group-active:scale-95">
            <Play className="h-3 w-3 fill-white" />
            {cta}
          </span>
        </div>
      </button>
    </section>
  );
}
