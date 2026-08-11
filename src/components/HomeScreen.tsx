import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Star,
  ChevronLeft,
  ChevronRight,
  Search,
  Flame,
  TrendingUp,
  User,
  Crown,
  Sparkles,
  Gift,
  X,
} from 'lucide-react';
import type { Show, ShowWithGenres, Genre } from '@/lib/types';
import { fetchFeaturedShows, fetchAllShows, fetchGenres } from '@/lib/api';
import ShowCard from '@/components/ShowCard';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import SupporterTicker from '@/components/SupporterTicker';
import CreatorCredit from '@/components/CreatorCredit';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import { usePresenceCount } from '@/lib/presence';

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
  /** Fired when the small logo badge in the header is tapped 5 times in
   *  quick succession — the hidden way to reach the admin sign-in on
   *  mobile, where there's no visible admin entry point. */
  onAdminSecretTap?: () => void;
}

export type Tab = 'home' | 'search' | 'watchlist' | 'account';

const HERO_AUTO_MS = 2200;

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
  onAdminSecretTap,
}: HomeScreenProps) {
  const { lang, setLang } = useLang();
  const t = appText[lang];
  const watchingNow = usePresenceCount();
  const [bannerShows, setBannerShows] = useState<Show[]>([]);
  const [shows, setShows] = useState<ShowWithGenres[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [interacting, setInteracting] = useState(false);
  const [viewAll, setViewAll] = useState<{ title: string; shows: Show[] } | null>(null);

  const touchStartX = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoTapTimes = useRef<number[]>([]);

  // Hidden admin entry point: 5 taps on the small logo badge within 2.5s
  // opens admin sign-in. Nothing else on mobile can reach it, since the
  // admin gate is desktop-only by design.
  const handleLogoTap = () => {
    const now = Date.now();
    logoTapTimes.current = [...logoTapTimes.current.filter((ts) => now - ts < 2500), now];
    if (logoTapTimes.current.length >= 5) {
      logoTapTimes.current = [];
      onAdminSecretTap?.();
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [f, s, g] = await Promise.all([
          fetchFeaturedShows(),
          fetchAllShows(),
          fetchGenres(),
        ]);
        if (!active) return;
        let banner = f;
        if (f.length < 4) {
          const fallback = [...s].sort((a, b) => b.rating - a.rating);
          const seen = new Set(f.map((x) => x.id));
          banner = [...f, ...fallback.filter((x) => !seen.has(x.id))].slice(0, 10);
        }
        setBannerShows(banner.slice(0, 10));
        setShows(s);
        setGenres(g);
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

  const trending = [...shows].sort((a, b) => b.rating - a.rating).slice(0, 10);
  const newReleases = [...shows]
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 10);

  const showsByGenre = useCallback(
    (slug: string) => shows.filter((s) => s.genres?.some((g) => g.slug === slug)),
    [shows],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0605] text-white">
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
        <div className="relative w-full overflow-hidden" style={{ height: 'min(32vh, 280px)' }}>
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
      <div className="flex min-h-screen items-center justify-center bg-[#0A0605] px-6">
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold text-[#E31E24]">{t.somethingWrong}</p>
          <p className="mt-2 text-sm text-white/60">{error}</p>
        </div>
      </div>
    );
  }

  const heroVisible = hero && !query.trim();

  return (
    <div className="relative min-h-screen bg-[#0A0605] text-white">
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
          className="h-full w-full object-cover opacity-[0.32]"
          style={{ objectPosition: '68% 30%', transform: 'scale(1.1)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0605]/25 via-[#0A0605]/55 to-[#0A0605]/88" />
        {/* Logo + wordmark watermark — sealed directly into the fixed
            background layer (not the header), so it never scrolls, never
            competes with header controls, and quietly carries the brand
            everywhere the way the old "LIVE" label used to. */}
        <img
          src="/assets/images/logo-transparent.png"
          alt=""
          className="absolute left-1/2 top-[64px] w-[58vw] max-w-[260px] -translate-x-1/2 opacity-[0.22] sm:top-[76px] sm:max-w-[300px]"
          draggable={false}
        />
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
            'radial-gradient(ellipse 60% 40% at 12% 0%, rgba(140,15,18,0.20) 0%, rgba(10,6,5,0) 60%), radial-gradient(ellipse 55% 45% at 88% 100%, rgba(255,201,74,0.10) 0%, rgba(10,6,5,0) 60%)',
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
          heroVisible ? 'bg-transparent' : 'bg-[#0A0605]/85 backdrop-blur-md'
        }`}
      >
        <div className="mx-auto flex max-w-[1400px] items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-8 sm:py-3">
          <button
            onClick={() => {
              setActiveTab('home');
              setQuery('');
              setViewAll(null);
              handleLogoTap();
            }}
            aria-label={t.navHome}
            className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-[#E31E24]/40"
          >
            <img
              src="/assets/images/icon-192.png"
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
            />
          </button>

          {/* Live "watching now" count — a real Realtime Presence tally
              (see src/lib/presence.ts), not a randomized/fake number. */}
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#E31E24]/25 bg-[#E31E24]/10 px-2 py-1 sm:px-2.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E31E24]/70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#E31E24]" />
            </span>
            <span className="text-xs font-bold text-white">{watchingNow.toLocaleString()}</span>
            <span className="hidden text-xs text-white/50 sm:inline">{t.watchingNow ?? 'watching now'}</span>
          </div>

          {/* Nav links — scrolls horizontally instead of wrapping/breaking
              on the narrowest phones, but fits on one line on anything
              typical. */}
          <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-4 overflow-x-auto sm:gap-5">
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
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/5 hover:text-white sm:hidden"
          >
            <Search className="h-4 w-4" />
          </button>
          <div className="relative hidden shrink-0 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-48 rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none transition focus:w-64 focus:border-[#E31E24]/50 focus:bg-white/[0.07]"
            />
          </div>
        </div>
      </header>

      {/* Everything below the fixed header sits in one padded flow —
          ticker directly under it, hero right after. The ticker used to
          be a `fixed` overlay guessing the header's pixel height, which is
          what made it visually collide with the header controls; being
          in-flow here means it can never land on top of them. */}
      <div className="relative z-10 pt-[52px] sm:pt-[60px]">
        <SupporterTicker />

        {/* Coverflow hero carousel */}
        {heroVisible && (
          <CoverflowHero
            shows={bannerShows}
            index={heroIndex}
            hero={hero}
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
      <main className="relative z-10 mx-auto max-w-[1400px] px-4 pb-10 sm:px-8 sm:pb-14">
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
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
              <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {filteredShows.map((s) => (
                  <ShowCard key={s.id} show={s} onClick={onSelectShow} />
                ))}
              </div>
            )}
          </section>
        ) : (
          <div className="pt-3">
            <RailRow
              title="Top 10"
              icon={<TrendingUp className="h-5 w-5 text-[#E31E24]" />}
              shows={trending}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.allShowsTitle ?? 'Top 10', shows })}
              viewAllLabel={t.viewAll}
              ranked
            />
            <RailRow
              icon={<Sparkles className="h-5 w-5 text-[#E31E24]" />}
              title={t.newRelease}
              shows={newReleases}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.allShowsTitle ?? t.newRelease, shows })}
              viewAllLabel={t.viewAll}
            />
            <RailRow
              icon={<Flame className="h-5 w-5 text-[#FFC94A]" />}
              title={t.popularSeason}
              shows={shows.slice(0, 10)}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.allShowsTitle ?? t.popularSeason, shows })}
              viewAllLabel={t.viewAll}
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

            {/* Utility bar — language, rewards, and the premium/subscribe
                entry, pushed all the way down to the bottom of the browse
                content per the person's request, instead of living right
                under the hero. */}
            <div className="mx-auto mt-10 flex max-w-[1400px] items-center justify-center gap-2.5 pb-1 pt-3">
              <div className="flex items-center rounded-full border border-white/10 bg-white/[0.05] p-1 backdrop-blur-md">
                <LanguageSwitcher lang={lang} onChange={setLang} bare />
              </div>
              {rewardsAvailable && (
                <button
                  onClick={onOpenRewards}
                  aria-label={t.rewardsBadge}
                  title={t.rewardsBadge}
                  className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#FFC94A]/30 bg-gradient-to-br from-[#FFC94A]/20 to-[#B8862E]/10 text-[#FFC94A] backdrop-blur-md transition hover:scale-105 hover:bg-[#FFC94A]/25 animate-badge-pop"
                >
                  <span className="absolute inset-0 rounded-full animate-glow-pulse" aria-hidden />
                  <Gift className="h-4 w-4" />
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#FF5D5D] ring-2 ring-[#0A0605]" aria-hidden />
                </button>
              )}
              <button
                onClick={onOpenSubscription}
                className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold text-black shadow-[0_4px_18px_rgba(255,201,74,0.35)] transition active:scale-95"
                style={{ background: 'linear-gradient(135deg, #FFE29A, #FFC94A 45%, #C9822E)' }}
              >
                <Crown className="h-3.5 w-3.5" />
                {subscribed ? t.premium : t.subscribe}
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 flex flex-col items-center gap-2 border-t border-white/5 px-4 py-8 text-center text-xs text-white/30 sm:px-8">
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
        <div className="fixed inset-0 z-[60] bg-[#0A0605] md:hidden">
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
                      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-[#241413] ring-1 ring-white/5">
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
};

interface CoverflowHeroProps {
  shows: Show[];
  index: number;
  hero: Show;
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
  const bg = hero.banner_url ?? hero.poster_url ?? '';

  // Reset the loaded flag whenever the background image changes so the
  // crossfade restarts for each new centered show.
  useEffect(() => {
    setBgLoaded(false);
  }, [hero.id]);

  // Ambient background drifts slower than the page (classic parallax) and
  // fades out as the user scrolls past the hero into the content rails.
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const heroHeightPx = typeof window !== 'undefined' ? Math.min(window.innerHeight * 0.32, 280) : 340;
  const parallaxOffset = Math.min(scrollY * 0.35, 120);
  const parallaxOpacity = Math.max(1 - scrollY / heroHeightPx, 0);

  return (
    <section
      className="relative w-full overflow-hidden"
      style={{ height: 'min(32vh, 280px)' }}
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
        {/* Warm gold/orange ambient glow blending with the app palette */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 85% 65% at 50% 18%, rgba(255,201,74,0.24) 0%, rgba(10,6,5,0) 60%), radial-gradient(ellipse 70% 55% at 78% 85%, rgba(227,30,36,0.24) 0%, rgba(10,6,5,0) 58%), radial-gradient(ellipse 60% 50% at 20% 85%, rgba(201,122,46,0.14) 0%, rgba(10,6,5,0) 55%)',
          }}
        />
        <div className="absolute inset-0 bg-[#0A0605]/35" />
        {/* Fade the top into the header and the bottom into the page */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(10,6,5,0.9) 0%, rgba(10,6,5,0.55) 14%, rgba(10,6,5,0.1) 28%, rgba(10,6,5,0) 40%, rgba(10,6,5,0) 68%, rgba(10,6,5,1) 100%)',
          }}
        />
        {/* Rising ember particles — small warm sparks drifting up from the
            base of the hero, echoing the keyart's ember/lightning motif
            without needing any extra image assets. */}
        <EmberParticles />
      </div>

      {/* Cards deck */}
      <div className="relative flex h-full items-center justify-center">
        {shows.length > 1 &&
          [-2, -1, 1, 2].map((offset) => {
            const i = (shows.length + index + offset) % shows.length;
            return (
              <SideCard
                key={shows[i].id}
                show={shows[i]}
                offset={offset}
                onClick={() => onGoTo(i)}
              />
            );
          })}

        {/* Center featured card */}
        <button
          key={hero.id}
          onClick={() => onSelectShow(hero)}
          className="hero-card-enter relative z-20 flex flex-col items-center"
          style={{
            width: '34%',
            maxWidth: 148,
            transform: 'translateZ(0)',
          }}
        >
          <div
            className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl transition-transform duration-500"
            style={{
              boxShadow:
                '0 30px 70px rgba(0,0,0,0.75), 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,210,120,0.25), 0 0 32px rgba(201,122,46,0.18)',
            }}
          >
            {/* subtle premium gold border */}
            <div className="pointer-events-none absolute inset-0 z-10 rounded-2xl ring-1 ring-inset ring-white/20" />
            <img
              src={hero.poster_url ?? hero.banner_url ?? ''}
              alt={hero.title}
              className="h-full w-full object-cover"
              draggable={false}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(10,6,5,0) 42%, rgba(10,6,5,0.6) 74%, rgba(10,6,5,0.96) 100%)',
              }}
            />
            {/* Rank badge only — dropped the separate "FEATURED" pill and
                the free/paid ribbon so the card reads clean against the
                artwork instead of being framed in badges. */}
            <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
              <span className="flex items-center gap-1 rounded-md bg-black/50 px-2 py-[3px] text-[10px] font-bold text-white backdrop-blur-sm">
                🔥 #{index + 1}
              </span>
            </div>
            {/* Title + rating + quick meta */}
            <div className="absolute inset-x-0 bottom-0 px-3 pb-3 text-center">
              <h2
                key={hero.id}
                className="title-shine truncate text-base font-black leading-tight sm:text-lg"
                style={{ fontFamily: '"Bebas Neue", Battambang, Inter, sans-serif', letterSpacing: '0.02em' }}
              >
                {hero.title.toUpperCase()}
              </h2>
              <div className="mt-1 flex items-center justify-center gap-2 text-xs font-semibold">
                <span className="flex items-center gap-1 text-[#FFC94A]">
                  <Star className="h-3 w-3 fill-[#FFC94A]" /> {Number(hero.rating).toFixed(1)}
                </span>
                <span className="h-3 w-px bg-white/20" aria-hidden />
                <span className="flex items-center gap-1 text-white/60">
                  {hero.type === 'movie' ? '🎬' : '📺'} {hero.release_year ?? '—'}
                </span>
              </div>
            </div>
          </div>
        </button>

        {/* Chevron arrows — desktop only, swipe handles mobile */}
        <button
          onClick={onPrev}
          className="absolute left-4 z-30 hidden h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-90 md:flex"
          aria-label="Previous"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          onClick={onNext}
          className="absolute right-4 z-30 hidden h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-90 md:flex"
          aria-label="Next"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Thin auto-play countdown bar — fills up over each slide's dwell
          time, doubling as the position indicator (its reset per slide
          already shows where you are), so the separate row of dots
          underneath it was redundant and has been removed. Keyed on the
          index so it restarts cleanly every time the centered card
          changes, whether from the timer or a manual swipe/tap. */}
      {shows.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 z-30 h-[3px] w-full overflow-hidden bg-white/10">
          <div
            key={index}
            className="hero-progress-fill h-full"
            style={{
              animationDuration: `${HERO_AUTO_MS}ms`,
              background: 'linear-gradient(90deg, #FFC94A, #E31E24)',
            }}
          />
        </div>
      )}

      {/* Tiny "auto-playing" cue — tucked in the corner, low-contrast on
          purpose so it reads as a quiet detail rather than competing with
          the poster art or the dots. */}
      {shows.length > 1 && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex items-center gap-1 rounded-full bg-black/30 px-2 py-1 backdrop-blur-sm">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FFC94A]/70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#FFC94A]" />
          </span>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-white/50">Auto</span>
        </div>
      )}
    </section>
  );
}

interface SideCardProps {
  show: Show;
  offset: number; // -2, -1, 1, 2
  onClick: () => void;
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

function SideCard({ show, offset, onClick }: SideCardProps) {
  const isNear = Math.abs(offset) === 1;
  const translateX = offset * 84;
  const scale = isNear ? 0.52 : 0.38;
  const z = isNear ? 10 : 5;
  const opacity = isNear ? 0.75 : 0.28;
  // A small vertical lift that grows with distance from center — this is
  // what reads as a "wave": the deck doesn't just slide sideways, the far
  // cards sit a touch lower like a trough, near cards ride a touch higher.
  const translateY = Math.abs(offset) * 14;

  return (
    <button
      onClick={onClick}
      className="absolute z-10"
      style={{
        width: '32%',
        maxWidth: 138,
        transform: `translateX(${translateX}%) translateY(${translateY}px) scale(${scale})`,
        zIndex: z,
        opacity,
        transition: 'transform 0.34s cubic-bezier(0.34,1.15,0.4,1), opacity 0.34s ease',
        pointerEvents: 'auto',
      }}
      aria-label={show.title}
    >
      <div
        className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl ring-1 ring-[#FFC94A]/15"
        style={{ boxShadow: '0 16px 40px rgba(0,0,0,0.6), inset 0 0 22px 2px rgba(227,30,36,0.16)' }}
      >
        <img
          src={show.poster_url ?? show.banner_url ?? ''}
          alt={show.title}
          className="h-full w-full object-cover"
          draggable={false}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(10,6,5,0) 50%, rgba(10,6,5,0.85) 100%)',
          }}
        />
        <div className="absolute inset-x-0 bottom-0 px-3 pb-3 text-center">
          <p className="truncate text-sm font-bold text-white">{show.title}</p>
          <div className="mt-0.5 flex items-center justify-center gap-1 text-xs font-semibold text-[#FFC94A]">
            <Star className="h-3 w-3 fill-[#FFC94A]" /> {Number(show.rating).toFixed(1)}
          </div>
        </div>
      </div>
    </button>
  );
}

/* ---------- Header nav link ---------- */

interface NavLinkProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavLink({ label, active, onClick }: NavLinkProps) {
  return (
    <button
      onClick={onClick}
      className={`relative shrink-0 whitespace-nowrap pb-0.5 text-xs font-semibold transition sm:text-sm ${
        active ? 'text-white' : 'text-white/55 hover:text-white/80'
      }`}
    >
      {label}
      {active && (
        <span className="absolute -bottom-1.5 left-1/2 h-[3px] w-4 -translate-x-1/2 rounded-full bg-[#E31E24]" />
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
}

function RailRow({ title, icon, emoji, shows, onSelectShow, onViewAll, viewAllLabel, ranked }: RailRowProps) {
  const scrollerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollLeft = 0;
  }, []);

  return (
    <section className="mt-9">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon ?? (emoji && <span className="text-base leading-none">{emoji}</span>)}
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        </div>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="shrink-0 text-xs font-semibold text-white/50 transition hover:text-[#E31E24]"
          >
            {viewAllLabel}
          </button>
        )}
      </div>
      <div
        ref={scrollerRef}
        className={`no-scrollbar flex gap-3 overflow-x-auto pb-2 ${ranked ? 'pt-1' : ''}`}
      >
        {shows.map((s, i) => (
          <ShowCard key={s.id} show={s} onClick={onSelectShow} rank={ranked ? i + 1 : undefined} />
        ))}
      </div>
    </section>
  );
}
