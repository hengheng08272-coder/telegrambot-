import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Star,
  ChevronLeft,
  ChevronRight,
  Search,
  Flame,
  User,
  Crown,
  Sparkles,
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
import { fetchAllShows, fetchGenres, fetchTickerMessage, fetchLatestEpisodeDates } from '@/lib/api';
import ShowCard from '@/components/ShowCard';
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
  const [viewAll, setViewAll] = useState<{ title: string; shows: Show[] } | null>(null);
  const [tickerMessage, setTickerMessage] = useState<string | undefined>(undefined);
  const [latestEpisodeDates, setLatestEpisodeDates] = useState<Record<string, string>>({});

  const touchStartX = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Continue Watching" — read once per mount (this screen fully
  // unmounts/remounts on navigation, so a fresh read here already stays
  // current without needing a storage listener).
  const [continueItems] = useState<ContinueItem[]>(() => getContinueWatching());

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
        fetchLatestEpisodeDates().then((dates) => {
          if (active) setLatestEpisodeDates(dates);
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
            <div className="h-[58%] w-[22%] max-w-[124px] animate-pulse rounded-2xl bg-white/5" />
            <div className="h-[74%] w-[38%] max-w-[164px] animate-pulse rounded-2xl bg-white/10" />
            <div className="h-[58%] w-[22%] max-w-[124px] animate-pulse rounded-2xl bg-white/5" />
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
          <p className="text-lg font-semibold text-[#FF2D46]">{t.somethingWrong}</p>
          <p className="mt-2 text-sm text-white/60">{error}</p>
        </div>
      </div>
    );
  }

  const heroVisible = hero && !query.trim();

  return (
    <div className="relative min-h-screen bg-app text-white">
      {/* Brand key art — sits behind absolutely everything, now shown
          clearly (no blur, higher opacity) per request. Cropped toward the
          character on the right so it doesn't fight with the separate
          wordmark watermark below; a top-to-bottom darkening keeps it
          vivid near the header and fades it out by the time content rows
          need clean contrast to read against. */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <img
          src="/assets/nint-keyart.jpg"
          alt=""
          className="h-full w-full object-cover opacity-[0.22]"
          style={{ objectPosition: '68% 30%', transform: 'scale(1.1)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#07080C]/40 via-[#07080C]/70 to-[#07080C]/94" />
      </div>

      {/* Whole-page ambient glow — two faint warm radials fixed to the
          viewport corners so the background still feels alive once the
          user has scrolled past the hero into the rails, instead of
          flattening to plain black. Kept very low-opacity and behind
          everything (z-0) so it never competes with poster art. */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 12% 0%, rgba(143,16,32,0.13) 0%, rgba(7,8,12,0) 60%), radial-gradient(ellipse 55% 45% at 88% 100%, rgba(245,197,99,0.06) 0%, rgba(7,8,12,0) 60%)',
        }}
        aria-hidden
      />

      {/* Header v4 — one responsive top nav bar for every screen size, per
          request: no more separate desktop-only nav row vs. a mobile-only
          bottom tab bar. Home / Series / Movies stay a browse filter right
          here (Series & Movies reuse the same "View All" grid the rail
          rows already use); My List actually leaves this screen, so it's
          styled the same but never shows an active state. Search is an
          inline expanding box from `sm:` up and a plain icon button that
          opens the full-screen search overlay below that. */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
          heroVisible ? 'bg-transparent' : 'bar-blur'
        }`}
      >
        <div className="mx-auto flex max-w-[1400px] items-center gap-1.5 px-2.5 py-2.5 sm:gap-3 sm:px-8 sm:py-3">
          {/* Profile avatar + Telegram username. The app-icon button that
              used to sit to the left of this was removed: Telegram already
              prints "NINTANIME mini app" in its own title bar directly
              above, so the icon was the third piece of branding in a
              40px-tall strip and pushed the person's own name off-screen
              on narrow phones. */}
          <button
            onClick={onOpenProfile}
            aria-label={t.navAccount}
            className="flex shrink-0 items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 transition hover:bg-white/5 sm:gap-2 sm:pr-2.5"
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ${
                subscribed ? 'ring-[#F5C563]' : 'ring-white/15'
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
            {/* Shown on every screen size — this was `hidden sm:inline`,
                which meant the one place the app addresses the viewer by
                name was invisible on the phones nearly everyone uses it
                on. Falls back to the real name when Telegram has no
                @username set, so the slot is never silently empty. */}
            {(telegramProfile?.username || telegramProfile?.fullName) && (
              <span className="max-w-[92px] truncate text-xs font-bold text-white sm:max-w-[130px]">
                {telegramProfile.username ? `@${telegramProfile.username}` : telegramProfile.fullName}
              </span>
            )}
          </button>

          {/* Live "watching now" count — a real Realtime Presence tally
              (see src/lib/presence.ts), not a randomized/fake number.
              Kept next to the profile chip, just tighter now that the
              chip above takes some of the header's width. */}
          <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-1 sm:gap-1.5 sm:px-2.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF2D46]/70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#FF2D46]" />
            </span>
            <span className="text-xs font-bold text-white">{watchingNow.toLocaleString()}</span>
            <span className="hidden text-[10px] text-white/50 sm:inline sm:text-xs">{t.watchingNow ?? 'watching now'}</span>
          </div>

          {/* Nav links — scrolls horizontally instead of wrapping/breaking
              on the narrowest phones, but fits on one line on anything
              typical. */}
          <nav className="no-scrollbar hidden min-w-0 flex-1 items-center gap-2.5 overflow-x-auto sm:flex sm:gap-5">
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
                setViewAll({ title: t.navMovies, shows: shows.filter((s) => s.type === 'movie') });
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
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-48 rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none transition focus:w-64 focus:border-[#FF2D46]/50 focus:bg-white/[0.07]"
            />
          </div>

          {/* Bell + VIP — per the requested header layout (logo · bell ·
              VIP), kept visible on every screen size and every scroll
              position, not just the bottom utility bar. */}
          <NotificationBell title={t.notifications ?? 'Notifications'} emptyLabel={t.noNotifications ?? ''} />
          <button
            onClick={onOpenSubscription}
            className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-black text-black shadow-[0_2px_10px_rgba(245,197,99,0.35)] transition active:scale-95 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs"
            style={{ background: 'linear-gradient(135deg, #FFE7B0, #F5C563 45%, #C08F33)' }}
          >
            <Crown className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            {subscribed ? t.premium : (t.vipBadge ?? 'VIP')}
          </button>
        </div>
      </header>

      {/* Everything below the fixed header sits in one padded flow —
          ticker directly under it, hero right after. The ticker used to
          be a `fixed` overlay guessing the header's pixel height, which is
          what made it visually collide with the header controls; being
          in-flow here means it can never land on top of them. */}
      <div className="relative z-10 pt-[52px] sm:pt-[60px]">
        {/* Logo + wordmark watermark — lives in the normal scrolling flow
            now (not the fixed background), so it scrolls away with the
            hero instead of staying pinned over the rows below it once the
            viewer scrolls down. */}
        <img
          src="/assets/images/logo-transparent.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-2 z-0 w-[58vw] max-w-[260px] -translate-x-1/2 opacity-[0.22] sm:top-4 sm:max-w-[300px]"
          draggable={false}
        />

        <SupporterTicker
          trendingTitle={trending[0]?.title}
          trendingPrefix={t.trendingNowPrefix}
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
      <main className="relative z-10 mx-auto max-w-[1400px] px-4 pb-24 sm:px-8 sm:pb-14">
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
            <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
              {viewAll.shows.map((s) => (
                <ShowCard key={s.id} show={s} onClick={onSelectShow} />
              ))}
            </div>
          </section>
        ) : query.trim() ? (
          <section className="pt-4">
            <h2 className="mb-5 text-xl font-bold">
              {t.resultsFor} &ldquo;{query}&rdquo;{' '}
              <span className="text-white/40">({filteredShows.length})</span>
            </h2>
            {filteredShows.length === 0 ? (
              <p className="py-20 text-center text-white/40">{t.noResults}</p>
            ) : (
              <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                {filteredShows.map((s) => (
                  <ShowCard key={s.id} show={s} onClick={onSelectShow} />
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
            {continueItems.length > 0 && (
              <ContinueWatchingRow
                items={continueItems}
                onResume={onResumeEpisode}
                title={t.continueWatching}
                epLabel={t.epShort}
              />
            )}
            {comingSoon.length > 0 && (
              <RailRow
                icon={<Clock className="h-5 w-5 text-[#FF6B7C]" />}
                title={t.comingSoonLabel}
                shows={comingSoon}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.comingSoonLabel, shows: comingSoon })}
                viewAllLabel={t.viewAll}
                tag={{ label: t.freshTag ?? 'SOON', color: '#FF6B7C' }}
              />
            )}
            {freeShows.length > 0 && (
              <RailRow
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
              icon={<Sparkles className="h-5 w-5 text-[#FF2D46]" />}
              title={t.newRelease}
              shows={newReleases}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.allShowsTitle, shows })}
              viewAllLabel={t.viewAll}
              tag={{ label: t.newTag ?? 'NEW', color: '#EDEDF0' }}
            />
            <RailRow
              icon={<Flame className="h-5 w-5 text-[#FF2D46]" />}
              title={t.popularSeason}
              shows={shows.slice(0, 10)}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.allShowsTitle, shows })}
              viewAllLabel={t.viewAll}
              tag={{ label: t.hotTag ?? 'HOT', color: '#FF2D46' }}
            />

            {genres.map((g) => {
              const list = showsByGenre(g.slug);
              if (list.length === 0) return null;
              return (
                <RailRow
                  key={g.id}
                  emoji={genreEmoji(g.slug)}
                  title={g.name}
                  shows={list}
                  onSelectShow={onSelectShow}
                  onViewAll={() => setViewAll({ title: t.allShowsTitle ?? g.name, shows })}
                  viewAllLabel={t.viewAll}
                />
              );
            })}

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
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#FF6B7C] ring-2 ring-[#07080C]" aria-hidden />
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="relative z-10 flex flex-col items-center gap-2 border-t border-white/5 px-4 pb-24 pt-8 text-center text-xs text-white/30 sm:px-8 sm:pb-8">
        <span>{t.footerTagline}</span>
        {onOpenLegal && (
          <button onClick={onOpenLegal} className="underline decoration-white/20 underline-offset-2 transition hover:text-white/60">
            {t.legalLink ?? 'Terms & Privacy'}
          </button>
        )}
        <CreatorCredit />
      </footer>

      {/* Full-screen search overlay (mobile) */}
      {searchOpen && (
        <div className="fixed inset-0 z-[60] bg-app md:hidden">
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
            <Search className="h-5 w-5 text-white/40" />
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
              className="rounded-full p-1.5 text-white/60 transition hover:text-white"
              aria-label="Close search"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="h-[calc(100%-65px)] overflow-y-auto px-4 py-4">
            {query.trim() ? (
              filteredShows.length === 0 ? (
                <p className="py-20 text-center text-white/40">{t.noResults}</p>
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
                <p className="text-sm text-white/40">{t.searchHint}</p>
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
          setViewAll({ title: t.navMovies, shows: shows.filter((s) => s.type === 'movie') });
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
  const [scrollY, setScrollY] = useState(0);
  const [inList, setInList] = useState(() => isInWatchlist(hero.id));
  const bg = hero.banner_url ?? hero.poster_url ?? '';

  // Reset the loaded flag and re-check watchlist status whenever the
  // centered show changes (auto-advance or swipe).
  useEffect(() => {
    setBgLoaded(false);
    setInList(isInWatchlist(hero.id));
  }, [hero.id]);

  // Ambient background drifts slower than the page (classic parallax) and
  // fades out as the user scrolls past the hero into the content rails.
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const heroHeightPx = typeof window !== 'undefined' ? Math.min(window.innerHeight * 0.32, 280) : 280;
  const parallaxOffset = Math.min(scrollY * 0.35, 120);
  const parallaxOpacity = Math.max(1 - scrollY / heroHeightPx, 0);

  return (
    <section
      className="relative w-full overflow-hidden px-4 pb-4 pt-1 sm:px-8 sm:pb-5 sm:pt-2"
      onTouchStart={(e) => onTouchStart(e.touches[0].clientX)}
      onTouchEnd={(e) => onTouchEnd(e.changedTouches[0].clientX)}
    >
      {/* Blurred ambient background driven by the centered show */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          transform: `translateY(${parallaxOffset}px)`,
          opacity: parallaxOpacity,
        }}
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
        <div className="absolute inset-0 bg-[#04050A]/42" />
        {/* Fade the top into the header and the bottom into the page */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(4,5,10,0.92) 0%, rgba(4,5,10,0.5) 16%, rgba(4,5,10,0) 34%, rgba(4,5,10,0) 74%, rgba(4,5,10,0.85) 92%, rgba(4,5,10,1) 100%)',
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
            className="relative z-10 aspect-[2/3] w-full overflow-hidden rounded-2xl transition-transform duration-500"
            style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.8), 0 6px 18px rgba(0,0,0,0.55)' }}
          >
            <div className="pointer-events-none absolute inset-0 z-10 rounded-2xl ring-1 ring-inset ring-white/12" />
            <img
              src={hero.poster_url ?? hero.banner_url ?? ''}
              alt={hero.title}
              className="h-full w-full object-cover"
              draggable={false}
            />
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(180deg, rgba(7,8,12,0) 60%, rgba(7,8,12,0.6) 100%)' }}
            />
            {/* Trending tag — a small corner flag instead of a numeral,
                only shown when the show is genuinely trending. */}
            {heroRank && (
              <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-black text-white backdrop-blur-sm">
                <span className="animate-pulse">🔥</span> TOP #{heroRank}
              </span>
            )}
            {/* VIP / Free badge — same subscription status the detail
                screen enforces, so the cover never over-promises. */}
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
          </div>
        </button>

        {/* Title + meta + actions */}
        <div className="min-w-0 flex-1 text-left">
          <span
            className="relative -top-1 mb-1 inline-flex items-center gap-1 rounded-full border border-[#FF2D46]/40 bg-[#FF2D46]/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[#FF6B7C] sm:text-[11px]"
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
            <p className="mt-0.5 truncate text-[11px] font-semibold text-white/50 sm:text-xs">{heroGenre}</p>
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
            {/* "Ongoing" — same gold-pill treatment as the Show Detail
                screen (bg-[#F5C563]/15 text-[#F5C563]), so the cue reads
                consistently across the app instead of inventing a
                separate style just for the hero. Means the show is still
                getting new episodes — not a livestream, the app has none. */}
            {hero.type === 'series' && hero.status !== 'completed' && (
              <>
                <span className="h-3 w-px bg-white/20" aria-hidden />
                <span className="rounded bg-[#F5C563]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[#F5C563] sm:text-[10px]">
                  {t.ongoing}
                </span>
              </>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 sm:mt-3.5 sm:gap-2.5">
            <button
              onClick={() => onSelectShow(hero)}
              className="flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-bold text-white shadow-[0_4px_16px_rgba(255,45,70,0.4)] transition active:scale-95 sm:px-5 sm:py-2 sm:text-xs"
              style={{ background: 'linear-gradient(135deg, #FF2D46, #FF2D46 55%, #8F1020)' }}
            >
              <Play className="h-3 w-3 fill-white sm:h-3.5 sm:w-3.5" /> {t.play}
            </button>
            <button
              onClick={() => {
                const now = toggleWatchlist(hero);
                setInList(now);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-bold transition active:scale-95 sm:px-5 sm:py-2 sm:text-xs ${
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
              background: '#FF2D46',
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
    // Floating dock rather than a full-width bar welded to the bottom
    // edge: the ambient background stays visible around it, and the
    // rounded frame matches the card language used everywhere else.
    <nav
      className="fixed inset-x-0 bottom-0 z-40 px-3 pt-2 sm:hidden"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' }}
    >
      <div className="mx-auto flex max-w-[560px] items-stretch justify-between rounded-[22px] border border-white/10 bar-blur px-1 py-0.5 shadow-[0_12px_34px_rgba(0,0,0,0.55)]">
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
      className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-[18px] py-2 transition ${
        active
          ? 'bg-[#FF2D46]/[0.12] text-[#FF6B7C]'
          : 'text-white/50 active:bg-white/5 active:text-white/80'
      }`}
    >
      {active && (
        <span
          className="pointer-events-none absolute inset-x-3 -top-px h-px rounded-full bg-gradient-to-r from-transparent via-[#FF2D46] to-transparent"
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
      className={`relative shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] font-semibold transition sm:text-sm ${
        active
          ? 'bg-white/[0.06] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
          : 'text-white/55 hover:bg-white/[0.04] hover:text-white/85'
      }`}
    >
      {label}
      {active && (
        <span className="absolute bottom-0.5 left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#FF6B7C] to-[#FF2D46] shadow-[0_0_10px_rgba(255,45,70,0.8)]" />
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

function RailRow({ title, icon, emoji, shows, onSelectShow, onViewAll, viewAllLabel, ranked, tag }: RailRowProps) {
  const scrollerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollLeft = 0;
  }, []);

  // Top 10 gets its own quiet backdrop — a blurred still of the #1 show,
  // echoing the hero's "cover" treatment — but it's a fixed image, not an
  // autoplaying/crossfading one: it only ever reflects whoever is
  // currently ranked #1, changing exactly when the ranking itself changes,
  // never on a timer.
  const backdropSrc = ranked ? shows[0]?.banner_url ?? shows[0]?.poster_url : null;

  return (
    <section className={ranked ? 'relative mt-8 overflow-hidden rounded-2xl' : 'mt-8'}>
      {ranked && backdropSrc && (
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <img
            src={backdropSrc}
            alt=""
            className="h-full w-full scale-110 object-cover opacity-[0.16] blur-2xl"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#07080C]/40 via-[#07080C]/70 to-[#07080C]" />
        </div>
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
                className="rounded-full px-2 py-[2px] text-[9px] font-black uppercase tracking-wider text-black"
                style={{ backgroundColor: tag.color }}
              >
                {tag.label}
              </span>
            )}
          </div>
          {onViewAll && (
            <button
              onClick={onViewAll}
              className="text-xs font-semibold text-white/50 transition hover:text-[#FF2D46]"
            >
              {viewAllLabel}
            </button>
          )}
        </div>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon ?? (emoji && <span className="text-base leading-none">{emoji}</span>)}
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            {tag && (
              <span
                className="rounded-full px-2 py-[2px] text-[9px] font-black uppercase tracking-wider text-black"
                style={{ backgroundColor: tag.color }}
              >
                {tag.label}
              </span>
            )}
          </div>
          {onViewAll && (
            <button
              onClick={onViewAll}
              className="shrink-0 text-xs font-semibold text-white/50 transition hover:text-[#FF2D46]"
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
          <ShowCard key={s.id} show={s} onClick={onSelectShow} rank={ranked ? i + 1 : undefined} />
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
        <Clock className="h-5 w-5 text-[#F5C563]" />
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
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FF2D46]/90 shadow-lg transition group-active:scale-90">
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
