import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Play,
  Star,
  ChevronLeft,
  ChevronRight,
  Search,
  Flame,
  TrendingUp,
  User,
  Crown,
  Home as HomeIcon,
  Bookmark,
  Unlock,
  Sparkles,
  Gift,
  X,
  Globe,
} from 'lucide-react';
import type { Show, ShowWithGenres, Genre } from '@/lib/types';
import { fetchFeaturedShows, fetchAllShows, fetchGenres } from '@/lib/api';
import ShowCard from '@/components/ShowCard';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

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
}

export type Tab = 'home' | 'search' | 'watchlist' | 'account';

const HERO_AUTO_MS = 3200;

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
}: HomeScreenProps) {
  const { lang, setLang } = useLang();
  const t = appText[lang];
  const [bannerShows, setBannerShows] = useState<Show[]>([]);
  const [shows, setShows] = useState<ShowWithGenres[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [interacting, setInteracting] = useState(false);
  const [viewAll, setViewAll] = useState<{ title: string; shows: Show[] } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const touchStartX = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const freeShows = shows.filter((s) => s.is_free);
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
        <div className="relative w-full overflow-hidden" style={{ height: 'min(46vh, 380px)' }}>
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
      {/* Brand key art — sits behind absolutely everything as soft, blurred
          atmosphere. This replaces a literal logo/wordmark in the header:
          the art itself carries the identity, dimmed and blurred enough
          that it never competes with poster thumbnails or text on top. */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <img
          src="/assets/nint-keyart.jpg"
          alt=""
          className="h-full w-full object-cover opacity-[0.16] blur-sm"
          style={{ transform: 'scale(1.1)' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0605]/60 via-[#0A0605]/85 to-[#0A0605]" />
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
            'radial-gradient(ellipse 60% 40% at 12% 0%, rgba(227,30,36,0.10) 0%, rgba(10,6,5,0) 60%), radial-gradient(ellipse 55% 45% at 88% 100%, rgba(255,201,74,0.07) 0%, rgba(10,6,5,0) 60%)',
        }}
        aria-hidden
      />

      {/* Header v2 — no logo/wordmark lockup anymore (the key-art
          background above now carries the brand). What used to live here
          is now just a bold "LIVE" pulse on the left; language + the old
          subscribe capsule have moved down into the bottom nav's freed-up
          slot (see "More" tab), since there's no account system to guard
          in this Mini App build. */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
          heroVisible ? 'bg-transparent' : 'bg-[#0A0605]/85 backdrop-blur-md'
        }`}
      >
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3.5 sm:px-8">
          <button
            onClick={() => {
              setActiveTab('home');
              setQuery('');
            }}
            className="flex items-center gap-2"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E31E24]/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#E31E24]" />
            </span>
            <span
              className="text-2xl font-black italic tracking-wide text-white drop-shadow-[0_2px_10px_rgba(227,30,36,0.5)] sm:text-3xl"
              style={{ fontFamily: '"Bebas Neue", Battambang, Inter, sans-serif' }}
            >
              LIVE
            </span>
          </button>

          {/* Desktop nav links */}
          <nav className="ml-6 hidden items-center gap-5 text-sm font-medium text-white/70 md:flex">
            <span className="cursor-pointer text-white transition hover:text-[#E31E24]">{t.navHome}</span>
            <span className="cursor-pointer transition hover:text-[#E31E24]">{t.navSeries}</span>
            <span className="cursor-pointer transition hover:text-[#E31E24]">{t.navMovies}</span>
            <span className="cursor-pointer transition hover:text-[#E31E24]">{t.navMyList}</span>
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* Desktop search box */}
            <div className="relative hidden sm:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-48 rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none transition focus:w-64 focus:border-[#E31E24]/50 focus:bg-white/[0.07]"
              />
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

            {/* Language switcher — desktop only now; on mobile it lives in
                the bottom nav's "More" tab alongside what used to be the
                account slot. */}
            <div className="hidden items-center rounded-full border border-white/10 bg-white/[0.05] p-1 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.25)] sm:flex">
              <LanguageSwitcher lang={lang} onChange={setLang} bare />
            </div>
          </div>
        </div>
      </header>

      {/* Coverflow hero carousel */}
      {heroVisible && (
        <div className="relative z-10">
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
        </div>
      )}

      {/* Content rows */}
      <main className="relative z-10 mx-auto max-w-[1400px] px-4 pb-28 sm:px-8 sm:pb-20">
        {viewAll ? (
          <section className="pt-28">
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
          <section className="pt-28">
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
          <div className={heroVisible ? 'pt-2' : 'pt-28'}>
            {freeShows.length > 0 && (
              <RailRow
                icon={<Unlock className="h-5 w-5 text-[#FFC94A]" />}
                title={t.freeWatching}
                shows={freeShows}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.freeWatching, shows: freeShows })}
                viewAllLabel={t.viewAll}
              />
            )}
            <RailRow
              icon={<TrendingUp className="h-5 w-5 text-[#E31E24]" />}
              title={t.trendingNow}
              shows={trending}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.trendingNow, shows: trending })}
              viewAllLabel={t.viewAll}
            />
            <RailRow
              icon={<Sparkles className="h-5 w-5 text-[#E31E24]" />}
              title={t.newRelease}
              shows={newReleases}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.newRelease, shows: newReleases })}
              viewAllLabel={t.viewAll}
            />
            <RailRow
              icon={<Flame className="h-5 w-5 text-[#FFC94A]" />}
              title={t.popularSeason}
              shows={shows.slice(0, 10)}
              onSelectShow={onSelectShow}
              onViewAll={() => setViewAll({ title: t.popularSeason, shows })}
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
                />
              );
            })}
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t border-white/5 px-4 py-8 text-center text-xs text-white/30 sm:px-8">
        {t.footerTagline}
      </footer>

      {/* Bottom navigation bar — mobile only */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#0A0605]/95 backdrop-blur-md md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
          <BottomTab
            icon={<HomeIcon className="h-5 w-5" />}
            label={t.navHome}
            active={activeTab === 'home'}
            onClick={() => setActiveTab('home')}
          />
          <BottomTab
            icon={<Search className="h-5 w-5" />}
            label={t.navSearch}
            active={searchOpen}
            onClick={() => setSearchOpen(true)}
          />
          <BottomTab
            icon={<Bookmark className="h-5 w-5" />}
            label={t.navWatchlist}
            active={activeTab === 'watchlist'}
            onClick={onOpenWatchlist}
          />
          <BottomTab
            icon={<Globe className="h-5 w-5" />}
            label={t.navMore ?? 'More'}
            active={moreOpen}
            onClick={() => setMoreOpen(true)}
          />
        </div>
      </nav>

      {/* "More" bottom sheet — holds what used to live in the header
          (language switcher, subscribe/VIP entry, rewards) now that the
          top bar is just the LIVE indicator. Slides up from the freed-up
          account slot in the bottom nav. */}
      {moreOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal>
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white/10 bg-[#120A09] p-5 pb-8 shadow-[0_-20px_60px_rgba(0,0,0,0.6)]">
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/15" />
            <div className="mb-5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/40">
                {t.navMore ?? 'More'}
              </span>
              <button
                onClick={() => setMoreOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-white/60"
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <span className="text-sm font-medium text-white/70">{t.language ?? 'Language'}</span>
              <LanguageSwitcher lang={lang} onChange={setLang} bare />
            </div>

            {rewardsAvailable && (
              <button
                onClick={() => {
                  setMoreOpen(false);
                  onOpenRewards();
                }}
                className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-[#FFC94A]/25 bg-gradient-to-r from-[#FFC94A]/15 to-[#B8862E]/5 px-4 py-3 text-left"
              >
                <Gift className="h-4 w-4 text-[#FFC94A]" />
                <span className="text-sm font-semibold text-[#FFC94A]">{t.rewardsBadge}</span>
              </button>
            )}

            <button
              onClick={() => {
                setMoreOpen(false);
                onOpenSubscription();
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left"
            >
              <Crown className="h-4 w-4 text-[#FFC94A]" />
              <span className="text-sm font-medium text-white/80">
                {subscribed ? t.premium : t.subscribe}
              </span>
            </button>
          </div>
        </div>
      )}

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

  const heroHeightPx = typeof window !== 'undefined' ? Math.min(window.innerHeight * 0.46, 380) : 380;
  const parallaxOffset = Math.min(scrollY * 0.35, 120);
  const parallaxOpacity = Math.max(1 - scrollY / heroHeightPx, 0);

  return (
    <section
      className="relative w-full overflow-hidden pt-[68px]"
      style={{ height: 'min(46vh, 380px)' }}
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
            width: '38%',
            maxWidth: 164,
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
            {/* FEATURED pill + rank badge */}
            <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
              <span
                className="rounded-md px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider text-black shadow-lg"
                style={{ background: 'linear-gradient(135deg, #FFC94A, #FFAA3C)' }}
              >
                {t.featured}
              </span>
              <span className="flex items-center gap-1 rounded-md bg-black/50 px-2 py-[3px] text-[10px] font-bold text-white backdrop-blur-sm">
                🔥 #{index + 1}
              </span>
            </div>
            {/* Free-to-watch ribbon — opposite corner from Featured, only
                when this title doesn't require a subscription */}
            {hero.is_free && (
              <span className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-md bg-[#FFC94A]/95 px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider text-black shadow-lg backdrop-blur-sm">
                🔓 {t.freeBadge}
              </span>
            )}
            {/* Title + rating + quick meta */}
            <div className="absolute inset-x-0 bottom-0 px-3 pb-3 text-center">
              <h2
                className="truncate text-base font-black leading-tight text-white sm:text-lg"
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

          {/* Play button — featured card only */}
          <div
            className="mt-2.5 flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-black shadow-lg transition active:scale-95"
            style={{ background: 'linear-gradient(135deg, #FFFFFF, #F1F1F1)' }}
          >
            <Play className="h-3.5 w-3.5 fill-black" /> {t.play}
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

      {/* Dot indicators */}
      {shows.length > 1 && (
        <div className="absolute inset-x-0 bottom-3 z-30 flex justify-center gap-2">
          {shows.map((_, i) => (
            <button
              key={i}
              onClick={() => onGoTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === index
                  ? 'w-6 bg-[#E31E24] shadow-[0_0_10px_rgba(227,30,36,0.8)]'
                  : 'w-2 bg-white/35 hover:bg-white/55'
              }`}
            />
          ))}
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

function SideCard({ show, offset, onClick }: SideCardProps) {
  const isNear = Math.abs(offset) === 1;
  const translateX = offset * 80;
  const scale = isNear ? 0.6 : 0.44;
  const z = isNear ? 10 : 5;
  const opacity = isNear ? 0.75 : 0.28;
  // A small vertical lift that grows with distance from center — this is
  // what reads as a "wave": the deck doesn't just slide sideways, the far
  // cards sit a touch lower like a trough, near cards ride a touch higher.
  const translateY = Math.abs(offset) * 10;

  return (
    <button
      onClick={onClick}
      className="absolute z-10"
      style={{
        width: '38%',
        maxWidth: 164,
        transform: `translateX(${translateX}%) translateY(${translateY}px) scale(${scale})`,
        zIndex: z,
        opacity,
        transition: 'transform 0.42s cubic-bezier(0.34,1.15,0.4,1), opacity 0.42s ease',
        pointerEvents: 'auto',
      }}
      aria-label={show.title}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
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

/* ---------- Bottom tab ---------- */

interface BottomTabProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function BottomTab({ icon, label, active, onClick }: BottomTabProps) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 transition ${
        active ? 'text-[#E31E24]' : 'text-white/50'
      }`}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
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
}

function RailRow({ title, icon, emoji, shows, onSelectShow, onViewAll, viewAllLabel }: RailRowProps) {
  const scrollerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollLeft = 0;
  }, []);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon ?? (emoji && <span className="text-base leading-none">{emoji}</span>)}
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-white/35">
            {shows.length}
          </span>
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
        className="no-scrollbar flex gap-3 overflow-x-auto pb-2"
      >
        {shows.map((s) => (
          <ShowCard key={s.id} show={s} onClick={onSelectShow} />
        ))}
      </div>
    </section>
  );
}
