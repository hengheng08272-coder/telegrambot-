import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Star,
  Flame,
  History,
  Layers,
  ChevronLeft,
  ChevronRight,
  Search,
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
  Radio,
} from 'lucide-react';
import type { Show, ShowWithGenres, Genre } from '@/lib/types';
import { fetchAllShows, fetchGenres, fetchTickerMessage, fetchShowEpisodeInfo, errorMessage, type ShowEpisodeInfo } from '@/lib/api';
import ShowCard from '@/components/ShowCard';
import Badge, { type BadgeTone } from '@/components/Badge';
import MovieCard from '@/components/MovieCard';
import SpotlightRail from '@/components/SpotlightRail';
import { MOVIE_PRICE } from '@/lib/moviePurchase';
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


  // Still releasing, as opposed to a finished series — that finished/still
  // going distinction no longer gets its own row (a completed show now
  // just carries a "ចប់ / Complete" tag on its card, wherever it turns up),
  // but this row still answers "what do I follow" on its own terms.
  const ongoingShows = shows.filter(
    (s) => s.type === 'series' && s.status !== 'completed' && !s.coming_soon,
  );
  // bannerShows come from fetchFeaturedShows (a plain Show, no genres
  // joined) — this looks the hero's access state up against the
  // already-loaded `shows` list (ShowWithGenres) instead of a second query.
  const showsById = new Map(shows.map((s) => [s.id, s]));

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

  // Every show belongs to exactly one row.
  //
  // Before this a single series could sit in Popular AND Binge AND
  // Ongoing AND two genre rails — the same cover five times down one
  // page, which made the catalog look far smaller than it is while
  // titles further down never got a slot at all. Rows claim shows in
  // the order they appear on screen: the first row that wants a show
  // takes it, and every row below sees only what is left. Rows that end
  // up empty hide themselves, exactly as they already did.
  //
  // The hero carousel at the top of the page counts as "already shown":
  // its titles are seeded into the claim set before any row runs, so a
  // cover sitting in the spotlight never turns up again in a rail three
  // hundred pixels below it. This is the repeat that was most visible,
  // since the hero and the first row are on screen together.
  //
  // The seasons section below is deliberately exempt — a franchise row
  // exists precisely to gather seasons that are scattered across the
  // page, so it re-shows them on purpose.
  const claimed = new Set<string>(bannerShows.map((s) => s.id));
  const claim = (list: ShowWithGenres[], limit?: number) => {
    const out: ShowWithGenres[] = [];
    for (const s of list) {
      if (claimed.has(s.id)) continue;
      out.push(s);
      claimed.add(s.id);
      if (limit && out.length >= limit) break;
    }
    return out;
  };
  const freeRow = claim(freeShows);
  // Most-watched first, so the single card the Movies panel spends its
  // height on is the one the most people already want.
  const movieRow = claim(
    [...oneOffMovies].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)),
  );
  // Sorted by the same real play-count signal the hero uses, but NOT
  // sliced to ten first: the hero has already claimed the top ten, so
  // slicing here would hand this row a list that is entirely spoken for
  // and leave it empty. Handing it the whole ranking lets it pick up at
  // eleven and read as "and then these".
  const popularRow = claim(
    [...shows].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)),
    10,
  );
  const recommendedRow = claim(recommended, 10);
  const ongoingRow = claim(ongoingShows);
  const genreRows = genres.map((g) => ({ genre: g, list: claim(showsByGenre(g.slug)) }));

  if (loading) {
    // The branded cover, not a grid of grey rectangles.
    //
    // The app already waits a beat here for Supabase, and a skeleton
    // spends that beat showing the shape of content nobody can read yet.
    // The 5B cover fills it with the thing the wait is for. It is not a
    // splash screen in the sense of something to dismiss — there is no
    // button, it is gone the moment the catalog arrives — which is the
    // only version of this that does not cost the viewer a tap.
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app">
        <img
          src="/assets/images/nintplex-cover-poster.png"
          alt=""
          aria-hidden
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.32) 40%, rgba(0,0,0,0.9) 82%, #0a101e 100%)',
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-4 px-8">
          <img
            src="/assets/images/nintplex-logo.png"
            alt="NintPlex"
            width={64}
            height={64}
            className="h-16 w-16 rounded-[14px]"
          />
          <span
            className="text-[26px] leading-none text-[#EEF1F8]"
            style={{ fontFamily: '"Anton", Battambang, Inter, sans-serif', letterSpacing: '0.02em' }}
          >
            NINT<span style={{ color: '#E6231F' }}>PLEX</span>
          </span>
          {/* An indeterminate bar rather than a spinner: it says "still
              working" without pretending to know a percentage. */}
          <span className="mt-1 block h-[3px] w-28 overflow-hidden rounded-full bg-white/12">
            <span className="loading-sweep block h-full w-1/2 rounded-full bg-[#E6231F]" />
          </span>
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
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#2050D8]/50 to-transparent transition-opacity duration-300 ${
            heroVisible && !scrolled ? 'opacity-0' : 'opacity-100'
          }`}
          aria-hidden
        />
        <div className="no-scrollbar mx-auto flex max-w-[1400px] flex-nowrap items-center gap-3 overflow-x-auto px-2.5 py-1.5 sm:gap-5 sm:px-8 sm:py-2">
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
                <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-vip-gradient ring-2 ring-[#0a101e]">
                  <Crown className="h-2 w-2 text-black" />
                </span>
              )}
              {rewardsAvailable === 'spin-ready' && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-glow-pulse rounded-full bg-[#FF6B60] ring-2 ring-[#0a101e]"
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
            <NavLink label={t.navMyList} active={false} onClick={onOpenWatchlist} highlight={continueItems.length > 0} />
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
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6A7591]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="w-44 rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none transition focus:w-60 focus:border-[#2050D8]/50 focus:bg-white/[0.07]"
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
                : 'flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-black text-white transition active:scale-95 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs'
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
      <div className="relative z-10 pt-[42px] sm:pt-[50px]">
        <SupporterTicker
          staticMessage={tickerMessage}
        />

        {/* Mosaic hero — banner strip with the poster hung off it (4A) */}
        {heroVisible && (
          <MosaicHero
            hero={hero}
            heroIsFree={showsById.get(hero.id)?.is_free ?? hero.is_free ?? false}
            heroIsMovie={(showsById.get(hero.id)?.type ?? hero.type) === 'movie'}
            episodeNumbers={episodeNumbers}
            onSelectShow={onSelectShow}
            onPrev={prevSlide}
            onNext={nextSlide}
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
            bannerShows={bannerShows}
            heroIndex={heroIndex}
            interacting={interacting}
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
              <div className="grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
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
              <div className="grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                {filteredShows.map((s) => (
                  <ShowCard key={s.id} show={s} onClick={onSelectShow} latestEpisode={episodeNumbers[s.id]} />
                ))}
              </div>
            )}
          </section>
        ) : (
          <div className="pt-3">
            {/* Keep Watching leads the page.
                
                It is the only row on the screen whose answer is already
                decided: this viewer started this episode and did not
                finish it. Everything below asks them to choose something;
                this one just hands back what they were doing, so it goes
                above all of it.

                Red, not blue, per the design system: "currently playing"
                is a fact about where they got to, not an offer — and the
                one rule the palette never breaks is that nothing red is
                a thing to press. The card itself is the press. */}
            {continueItems.length > 0 && (
              <section
                className="rail-section"
                style={{ '--row-accent': ROW_ACCENT.mark } as React.CSSProperties}
              >
                <RowHeading
                  title={t.continueRowLabel ?? 'Keep Watching'}
                  accent={ROW_ACCENT.mark}
                  icon={<History className="h-5 w-5" />}
                  rule={false}
                  onViewAll={onOpenWatchlist}
                  viewAllLabel={t.viewAll}
                  viewAllShort={t.viewAllShort}
                />
                <div className="rail-scroller no-scrollbar flex gap-3 overflow-x-auto pb-3">
                  {continueItems.map((item) => (
                    <ShowCard
                      key={item.show.id}
                      show={item.show}
                      // Straight back into the episode they left, not to
                      // the show page — a resume row that makes you pick
                      // the episode again has not resumed anything.
                      onClick={() => onResumeEpisode(item.show, item.episode.id)}
                      latestEpisode={item.episode.episode_number}
                    />
                  ))}
                </div>
              </section>
            )}
            {/* Popular leads the page — it is the row with the catalog's
                best artwork and the one that answers "what is everyone
                watching" before anything else gets a chance to ask. Free
                follows it: a signed-out viewer still meets the one row
                they can act on without scrolling past the whole page.
                Note the claim order in the derivation above runs the
                other way round, so Popular cannot swallow the free
                titles on its way through. */}
            {popularRow.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="mark"
                icon={<Flame className="h-5 w-5" />}
                title={t.featuredLabel ?? t.popularSeason}
                shows={popularRow}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.allShowsTitle, shows })}
                viewAllLabel={t.viewAll}
              />
            )}

            {/* Free-to-watch, straight after Popular. Empty until shows
                are marked "unlock all" (shows.is_free) in Admin -> Shows;
                the row hides itself until then. */}
            {freeRow.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="free"
                icon={<Gift className="h-5 w-5" />}
                title={t.freeRowLabel ?? 'Free to Watch'}
                shows={freeRow}
                onSelectShow={onSelectShow}
                continuesAt={continuesAt}
                onViewAll={() => setViewAll({ title: t.freeRowLabel ?? 'Free to Watch', shows: freeRow })}
                viewAllLabel={t.viewAll}
              />
            )}
            {/* The ranked/numeral "Top 10" rail was removed per request —
                the featured carousel above already surfaces what's trending
                without repeating it as a second ranked row underneath. */}
            {/* Movies get the wide format rather than a compact rail:
                there are only ever a handful of them, they are the one
                thing on the page that costs money outright, and a 16:9
                frame at full width is what a viewer reads as "this is
                being offered to me" instead of "here is more catalog".
                One frame at a time, swiped, with dots for the rest. */}
            {movieRow.length > 0 && (
              <section
                className="rail-section mt-8"
                style={{ '--row-accent': ROW_ACCENT.vip } as React.CSSProperties}
              >
                <RowHeading
                  title={t.navMovies}
                  accent={ROW_ACCENT.vip}
                  icon={<Film className="h-5 w-5" />}
                  badge={<Badge tone="price">${MOVIE_PRICE}</Badge>}
                  onViewAll={
                    movieRow.length > 1
                      ? () => setViewAll({ title: t.navMovies, shows: movieRow, movies: true })
                      : undefined
                  }
                  viewAllLabel={t.viewAll}
                  viewAllShort={t.viewAllShort}
                />
                <SpotlightRail shows={movieRow} onSelectShow={onSelectShow} />
              </section>
            )}
            {recommendedRow.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="guide"
                icon={<Star className="h-5 w-5" />}
                title={t.recommendedForYou ?? 'Recommended for You'}
                shows={recommendedRow}
                onSelectShow={onSelectShow}
              />
            )}
            {/* Trending is the row the mosaic was designed around: each
                title as a 2:3 poster butted against a 16:9 crop of
                itself. It gets the catalog's most-watched titles, which
                are also the ones most likely to have real banner art. */}
            {ongoingRow.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="mark"
                icon={<Radio className="h-5 w-5" />}
                title={t.ongoingRowLabel}
                shows={ongoingRow}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.ongoingRowLabel, shows: ongoingRow })}
                viewAllLabel={t.viewAll}
              />
            )}

            {genreRows.map(({ genre: g, list }) => {
              if (list.length === 0) return null;
              return (
                <RailRow
                  key={g.id}
                  episodeNumbers={episodeNumbers}
                  emoji={genreEmoji(g.slug)}
                  title={g.name}
                  shows={list}
                  onSelectShow={onSelectShow}
                  onViewAll={() => setViewAll({ title: g.name, shows: showsByGenre(g.slug) })}
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
                <RowHeading
                  title={t.seasonsRowLabel}
                  accent={ROW_ACCENT.guide}
                  icon={<Layers className="h-5 w-5" />}
                />
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
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#FF6B60] ring-2 ring-[#0a101e]" aria-hidden />
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
                      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-[#151926] ring-1 ring-white/5">
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

/* ---------- Mosaic hero (handoff 4A) ---------- */

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
  watchNow?: string;
  seasonShort: string;
  epShort: string;
};

interface MosaicHeroProps {
  hero: Show;
  heroIsFree: boolean;
  heroIsMovie: boolean;
  /** show id -> newest episode number, for the hero's meta line. */
  episodeNumbers?: Record<string, number>;
  onSelectShow: (s: Show) => void;
  onPrev: () => void;
  onNext: () => void;
  onTouchStart: (x: number) => void;
  onTouchEnd: (x: number) => void;
  t: TranslationText;
  /** The full hero rotation and where we are in it — drives the
   *  story-style progress segments across the top of the banner. */
  bannerShows: Show[];
  heroIndex: number;
  /** True while a finger/mouse is holding the hero (mirrors the
   *  autoTimer pause logic already driving the rotation) — freezes the
   *  active segment instead of it silently finishing under a thumb. */
  interacting: boolean;
}

/**
 * The 4A hero: a wide banner with the poster hung off its bottom edge.
 *
 * The banner is the surface and the poster is the signature — the poster
 * is deliberately small (88×132) and overlaps the banner by 46px, so the
 * two read as one masthead rather than as a backdrop with a card parked
 * on it. Everything else (title, meta, the two buttons) hangs off the
 * poster's baseline.
 *
 * There is no blurred copy of the artwork behind this any more. That
 * existed to fill a wide empty band around a small poster; the banner
 * now fills the width itself, and a `blur-3xl` full-bleed image is one
 * of the more expensive things a phone GPU can be asked to repaint on
 * scroll.
 */
function MosaicHero({
  hero,
  heroIsFree,
  heroIsMovie,
  episodeNumbers,
  onSelectShow,
  onPrev,
  onNext,
  onTouchStart,
  onTouchEnd,
  t,
  bannerShows,
  heroIndex,
  interacting,
}: MosaicHeroProps) {
  const [inList, setInList] = useState(() => isInWatchlist(hero.id));

  useEffect(() => {
    setInList(isInWatchlist(hero.id));
  }, [hero.id]);

  const banner = hero.banner_url ?? hero.poster_url ?? '';
  const poster = hero.poster_url ?? hero.banner_url ?? '';
  const { season } = parseSeason(hero.title);
  const ep = episodeNumbers?.[hero.id];

  const meta: string[] = [];
  if (season !== null) meta.push(`${t.seasonShort}${season}`);
  if (ep && hero.type !== 'movie') meta.push(`${t.epShort} ${ep}`);

  const accessBadge = hero.coming_soon ? (
    <Badge tone="mark" onArt square icon={<Clock className="h-3 w-3" />}>
      {t.comingSoonLabel}
    </Badge>
  ) : heroIsFree ? (
    <Badge tone="free" onArt square>
      {t.freeBadge}
    </Badge>
  ) : heroIsMovie ? (
    <Badge tone="price" onArt square className="whitespace-nowrap">
      {t.movieOneOff}
    </Badge>
  ) : (
    <Badge tone="vip" onArt square icon={<Crown className="h-3 w-3" />}>
      {t.vipBadge ?? 'VIP'}
    </Badge>
  );

  return (
    <section
      className="relative w-full overflow-hidden"
      onTouchStart={(e) => onTouchStart(e.touches[0].clientX)}
      onTouchEnd={(e) => onTouchEnd(e.changedTouches[0].clientX)}
    >
      {/* One card, not a banner-plus-floating-card — logo, title, art
          glow and both CTAs all inside a single rounded container, the
          way a poster-style key-art card reads as one graphic rather
          than layered pieces. Height is a compromise: tall enough for
          the composition to breathe, short enough that "មើលបន្ត" is
          still visible on load rather than needing a scroll first. */}
      <div className="relative mx-3 mt-2 h-[320px] overflow-hidden rounded-[22px] bg-gradient-to-br from-[#0A0E1C] via-[#0D1530] to-[#1A2C52] sm:mx-8 sm:h-[380px] lg:h-[440px]">
        {/* Ambient light — a vertical beam plus a soft blob, standing in
            for the art's own colour until real key-art is dropped in
            behind it. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-[38%] w-[26%] opacity-80"
          style={{ background: 'linear-gradient(180deg, rgba(78,134,255,0.28), rgba(78,134,255,0.05) 60%, transparent)' }}
        />
        <div
          aria-hidden
          className="absolute right-6 top-1/3 h-[190px] w-[190px] -translate-y-1/2 rounded-full opacity-70 blur-2xl"
          style={{ background: 'radial-gradient(circle, rgba(120,110,255,0.35), transparent 70%)' }}
        />

        {/* The show's own art — mid-right, blended edges rather than a
            hard rectangle, so it reads as part of the glow instead of a
            photo dropped on top of it. Swap in `banner` once real
            artwork is wired through; until then the ambient glow above
            carries the composition on its own. */}
        {poster && (
          <img
            src={poster}
            alt=""
            aria-hidden
            decoding="async"
            draggable={false}
            className="absolute right-8 top-1/2 h-[54%] w-[46%] -translate-y-1/2 rounded-[18px] object-cover opacity-80"
            style={{
              WebkitMaskImage: 'radial-gradient(ellipse at center, #000 55%, transparent 85%)',
              maskImage: 'radial-gradient(ellipse at center, #000 55%, transparent 85%)',
            }}
          />
        )}

        {/* Wordmark — part of the card's own graphic, not a header bar
            sitting above it. */}
        <div className="absolute left-5 top-5 flex items-center gap-2 sm:left-7 sm:top-7">
          <div className="h-7 w-7 rounded-[8px] bg-gradient-to-br from-[#4E86FF] to-[#0E2560] sm:h-8 sm:w-8" />
          <span className="font-display text-lg tracking-wide text-white sm:text-xl">
            NINT<span className="text-accent">PLEX</span>
          </span>
        </div>

        {/* Story-style progress segments — one per slide, filling over
            HERO_AUTO_MS via the existing hero-progress-fill keyframe
            (see index.css). Pauses while a finger holds the card. */}
        {bannerShows.length > 1 && (
          <div className="absolute inset-x-16 top-6 z-10 flex gap-1 sm:inset-x-24">
            {bannerShows.map((show, i) => (
              <span key={show.id} className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/20">
                {i === heroIndex && (
                  <span
                    key={`${show.id}-${heroIndex}`}
                    className="block h-full origin-left rounded-full bg-[#4E86FF]"
                    style={{
                      animation: `hero-progress-fill ${HERO_AUTO_MS}ms linear forwards`,
                      animationPlayState: interacting ? 'paused' : 'running',
                    }}
                  />
                )}
                {i < heroIndex && <span className="block h-full rounded-full bg-[#4E86FF]" />}
              </span>
            ))}
          </div>
        )}

        {/* Title block — vertically centred on the left, the way the
            reference sits it against the glow rather than pinned to a
            corner. */}
        <div className="absolute left-5 top-1/2 max-w-[62%] -translate-y-1/2 sm:left-7">
          <span className="mb-2 flex">{accessBadge}</span>
          <h2
            onClick={() => onSelectShow(hero)}
            className="line-clamp-2 cursor-pointer text-[22px] font-bold leading-[1.25] text-white sm:text-[28px]"
          >
            {hero.title}
          </h2>
          <div className="my-3 h-[3px] w-9 rounded-full bg-[#E6231F]" />
          {meta.length > 0 && (
            <p className="truncate text-[13px] font-bold text-white/50 sm:text-sm">{meta.join(' · ')}</p>
          )}
        </div>

        {/* Two controls, full width at the card's own bottom edge — the
            reference's wide pill primary plus a square icon secondary,
            both inside the same card rather than hanging below it. */}
        <div className="absolute inset-x-5 bottom-5 flex gap-2.5 sm:inset-x-7 sm:bottom-7">
          <button
            onClick={() => onSelectShow(hero)}
            className="flex h-[46px] flex-1 items-center justify-center gap-2 text-[14px] font-bold text-white transition active:scale-[0.98] sm:h-[52px] sm:text-[15px]"
            style={{
              borderRadius: 24,
              background: 'linear-gradient(135deg, #2050D8 0%, #1A3FAE 55%, #0E2560 100%)',
              boxShadow: '0 8px 24px rgba(32,80,216,0.45)',
            }}
          >
            {hero.coming_soon ? (
              <>
                <Clock className="h-4 w-4" /> {t.comingSoonLabel}
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-white" /> {t.watchNow ?? t.play}
              </>
            )}
          </button>
          <button
            onClick={() => setInList(toggleWatchlist(hero))}
            aria-label={t.myList}
            title={t.myList}
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center text-white transition active:scale-[0.98] sm:h-[52px] sm:w-[52px]"
            style={{
              borderRadius: 16,
              background: 'rgba(255,255,255,0.06)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)',
            }}
          >
            {inList ? <Check className="h-[18px] w-[18px]" /> : <Plus className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>

      {/* Chevron arrows — desktop only, swipe handles mobile. */}
      <button
        onClick={onPrev}
        className="absolute left-4 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-90 md:flex"
        aria-label="Previous"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        onClick={onNext}
        className="absolute right-4 top-1/2 z-30 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 active:scale-90 md:flex"
        aria-label="Next"
      >
        <ChevronRight className="h-6 w-6" />
      </button>

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
      // The active tab is a filled capsule rather than a hairline rule
      // above the icon. At the bottom of a mosaic screen a 2px underline
      // reads as another one of the page's many horizontal rules; a
      // filled block does not compete with them.
      className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 transition ${
        active ? 'text-[#4E86FF]' : highlight ? 'text-[#4E86FF]' : 'text-[#6A7591] active:text-white/80'
      }`}
    >
      {active && (
        <span
          className="pointer-events-none absolute inset-x-1 inset-y-1 rounded-[3px] bg-[#2050D8]/[0.18]"
          aria-hidden
        />
      )}
      <span className="relative">
        {icon}
        {highlight && !active && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#4E86FF] shadow-[0_0_6px_rgba(78,134,255,0.9)]" aria-hidden />
        )}
      </span>
      <span
        className={`relative max-w-full truncate px-0.5 text-[9.5px] leading-none ${
          active || (highlight && !active) ? 'font-bold' : 'font-semibold'
        }`}
      >
        {label}
      </span>
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
      className={`relative shrink-0 whitespace-nowrap px-0.5 pb-2 pt-1 text-[11px] transition sm:text-sm ${
        active
          ? 'font-display font-bold tracking-wide text-white'
          : highlight
            ? 'font-bold text-[#4E86FF]'
            : 'font-semibold text-white/50 hover:text-white/80'
      }`}
    >
      {label}
      {highlight && !active && (
        <span className="absolute -right-2 top-0.5 h-1.5 w-1.5 rounded-full bg-[#4E86FF] shadow-[0_0_6px_rgba(78,134,255,0.9)]" aria-hidden />
      )}
      {active && (
        <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-gradient-to-r from-[#4E86FF] to-[#2050D8] shadow-[0_0_10px_rgba(32,80,216,0.8)]" />
      )}
    </button>
  );
}

/* ---------- Content rail row ---------- */

/**
 * The heading every row on this page wears (handoff 4A).
 *
 * A 3px bar in the row's own colour, the title at 15/700, and the "see
 * the rest" link as plain text on the right. Three rows used to build
 * this themselves with slightly different spacing and a different title
 * size each; the page read as three unrelated sections stacked up
 * because it literally was.
 *
 * The accent drives the bar and the fading rule above it, never the
 * title colour — a coloured heading and a coloured bar saying the same
 * thing is one signal too many, and it is the bar that survives being
 * glanced at.
 */
function RowHeading({
  title,
  accent,
  icon,
  badge,
  onViewAll,
  viewAllLabel,
  viewAllShort,
  rule = true,
}: {
  title: string;
  accent: string;
  /** A lucide icon at h-5 w-5 carrying NO colour class of its own — the
   *  row's role decides the colour. DESIGN_SYSTEM forbids painting an
   *  icon before it gets here, and that rule is the whole reason the
   *  heading colours stay a palette instead of eleven one-off choices. */
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  onViewAll?: () => void;
  viewAllLabel?: string;
  viewAllShort?: string;
  rule?: boolean;
}) {
  return (
    <>
      {rule && (
        <div
          className="h-px w-full"
          style={{ background: `linear-gradient(90deg, ${tint(accent, 0.55)} 0%, transparent 100%)` }}
          aria-hidden
        />
      )}
      <div className="flex items-center justify-between gap-2 pb-2 pt-3">
        <span className="flex min-w-0 items-center gap-[9px]">
          <span
            className="h-[17px] w-[3px] shrink-0"
            style={{ background: accent, boxShadow: `0 0 10px ${tint(accent, 0.55)}` }}
            aria-hidden
          />
          {icon && (
            <span className="flex shrink-0 items-center" style={{ color: accent }} aria-hidden>
              {icon}
            </span>
          )}
          <h2 className="truncate text-[15px] font-bold text-[#EEF1F8] sm:text-lg">{title}</h2>
          {badge}
        </span>
        {onViewAll && (
          <button
            onClick={onViewAll}
            aria-label={viewAllLabel}
            title={viewAllLabel}
            className="shrink-0 text-[11px] tracking-[0.12em] text-[#6A7591] transition hover:text-white"
            style={{ fontFamily: '"Anton", Battambang, Inter, sans-serif' }}
          >
            {viewAllShort} ›
          </button>
        )}
      </div>
    </>
  );
}

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
  seasons,
  subRow,
  continuesAt,
}: RailRowProps) {
  const scrollerRef = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollLeft = 0;
  }, []);
  const accent = ROW_ACCENT[role];
  const { lang } = useLang();
  const t = appText[lang];

  // When every card in a rail carries the same access badge, that badge
  // describes the ROW, not eight separate posters — so it is printed once
  // in the heading and left off the artwork entirely. A rail whose cards
  // genuinely differ keeps the per-card badges, because there the badge
  // is the only thing telling two neighbouring covers apart.
  const rowAccess = useMemo(() => {
    if (shows.length === 0) return null;
    const key = (s: Show) =>
      s.coming_soon
        ? 'soon'
        : s.type === 'movie'
          ? s.is_free
            ? 'free'
            : 'movie'
          : s.is_free
            ? 'free'
            : 'vip';
    const first = key(shows[0]);
    return shows.every((s) => key(s) === first) ? first : null;
  }, [shows]);

  const rowAccessBadge =
    rowAccess === 'soon' ? (
      <Badge tone="mark" icon={<Clock className="h-3 w-3" />}>
        {t.comingSoonLabel}
      </Badge>
    ) : rowAccess === 'free' ? (
      <Badge tone="free">{t.freeBadge}</Badge>
    ) : rowAccess === 'movie' ? (
      <Badge tone="price">${MOVIE_PRICE}</Badge>
    ) : rowAccess === 'vip' ? (
      <Badge tone="vip" icon={<Crown className="h-3 w-3" />}>
        {t.vipBadge}
      </Badge>
    ) : null;

  return (
    <section
      // `rail-section` is what keeps a page of eleven rails scrolling at
      // frame rate: it lets the browser skip layout and paint for rows
      // that are nowhere near the viewport. `--row-accent` is read by
      // every ShowCard inside, so a card lights up in its own row's
      // colour rather than one hard-coded blue.
      className={`rail-section ${subRow ? 'mt-3' : 'mt-8'}`}
      style={{ '--row-accent': accent } as React.CSSProperties}
    >
      {subRow ? (
        // A sub-row sits inside an already-titled section, so it drops
        // the rule and the accent bar rather than repeating its parent's.
        <div className="mb-1.5 flex items-center gap-2 pl-3">
          {(icon || emoji) && (
            <span className="flex shrink-0 items-center text-sm" style={{ color: accent }} aria-hidden>
              {icon ?? emoji}
            </span>
          )}
          <h3 className="truncate text-[13px] font-bold text-white/90">{title}</h3>
          {tag ? <Badge tone={tag.tone ?? 'info'}>{tag.label}</Badge> : rowAccessBadge}
        </div>
      ) : (
        <RowHeading
          title={title}
          accent={accent}
          // A row-level tag (SOON) wins the slot over the access badge the
          // whole row shares, so the heading never carries two chips
          // saying different things.
          badge={tag ? <Badge tone={tag.tone ?? 'info'}>{tag.label}</Badge> : rowAccessBadge}
          onViewAll={onViewAll}
          viewAllLabel={viewAllLabel}
          viewAllShort={t.viewAllShort}
        />
      )}
      <div ref={scrollerRef} className="rail-scroller no-scrollbar flex gap-3 overflow-x-auto pb-3">
        {shows.map((s) => (
          <ShowCard
            key={s.id}
            show={s}
            onClick={onSelectShow}
            latestEpisode={episodeNumbers?.[s.id]}
            seasonNumber={seasons?.[s.id]?.season}
            titleFromSeason={subRow}
            continuesAtSeason={continuesAt?.[s.id]}
            hideAccessBadge={rowAccess !== null}
          />
        ))}
      </div>
    </section>
  );
}
