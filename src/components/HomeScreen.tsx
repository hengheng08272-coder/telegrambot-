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

  // Top 10 now reflects real audience behavior — actual play counts
  // (see increment_show_view_count) — instead of an admin-typed rating
  // number, so it genuinely shows which shows viewers watch the most.
  const trending = [...shows].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)).slice(0, 10);
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

  // Still releasing, as opposed to a finished series — that finished/still
  // going distinction no longer gets its own row (a completed show now
  // just carries a "ចប់ / Complete" tag on its card, wherever it turns up),
  // but this row still answers "what do I follow" on its own terms.
  const ongoingShows = shows.filter(
    (s) => s.type === 'series' && s.status !== 'completed' && !s.coming_soon,
  );
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
  const recommendedRow = claim(recommended, 10);
  // Sorted by the same real play-count signal the hero uses, but NOT
  // sliced to ten first: the hero has already claimed the top ten, so
  // slicing here would hand this row a list that is entirely spoken for
  // and leave it empty. Handing it the whole ranking lets it pick up at
  // eleven and read as "and then these", which is what a Popular row
  // under a Top-10 spotlight is actually for.
  const popularRow = claim(
    [...shows].sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)),
    10,
  );
  const bingeRow = claim(bingeShows, 14);
  const ongoingRow = claim(ongoingShows);
  const genreRows = genres.map((g) => ({ genre: g, list: claim(showsByGenre(g.slug)) }));

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
                    className="aspect-[2/3] w-28 shrink-0 animate-pulse rounded-xl bg-white/5 sm:w-36"
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
                immediately goes first rather than three rows down. Plain
                divider-row treatment like every other rail below it now
                (no boxed panel background) — the FREE tag next to the
                title already says what this row is without framing it.
                Empty until shows are marked "unlock all" (shows.is_free)
                in Admin -> Shows; the row hides itself until then. */}
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
                <div className="mb-3.5 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-4 w-[3px] shrink-0 rounded-sm"
                      style={{ background: ROW_ACCENT.vip, boxShadow: `0 0 10px ${tint(ROW_ACCENT.vip, 0.5)}` }}
                      aria-hidden
                    />
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
                    <Badge tone="price">${MOVIE_PRICE}</Badge>
                  </div>
                  {movieRow.length > 1 && (
                    <button
                      onClick={() => setViewAll({ title: t.navMovies, shows: movieRow, movies: true })}
                      aria-label={t.viewAll}
                      title={t.viewAll}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#9AA4BD] transition hover:bg-white/5 hover:text-white"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
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
            {popularRow.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="mark"
                icon={<Flame className="h-5 w-5" />}
                title={t.popularSeason}
                shows={popularRow}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.allShowsTitle, shows })}
                viewAllLabel={t.viewAll}
              />
            )}

            {bingeRow.length > 0 && (
              <RailRow
                episodeNumbers={episodeNumbers}
                role="guide"
                icon={<ListVideo className="h-5 w-5" />}
                title={t.bingeRowLabel}
                shows={bingeRow}
                onSelectShow={onSelectShow}
                onViewAll={() => setViewAll({ title: t.bingeRowLabel, shows: bingeRow })}
                viewAllLabel={t.viewAll}
              />
            )}
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
                <div
                  className="mb-4 h-px w-full"
                  style={{
                    background: `linear-gradient(90deg, ${tint(ROW_ACCENT.guide, 0.55)} 0%, ${tint(ROW_ACCENT.guide, 0.14)} 22%, rgba(255,255,255,0.05) 55%, transparent 100%)`,
                  }}
                  aria-hidden
                />
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className="h-4 w-[3px] shrink-0 rounded-sm"
                    style={{ background: ROW_ACCENT.guide, boxShadow: `0 0 10px ${tint(ROW_ACCENT.guide, 0.5)}` }}
                    aria-hidden
                  />
                  <Layers className="h-5 w-5 shrink-0" style={{ color: ROW_ACCENT.guide }} />
                  <h2 className="truncate text-[15px] font-bold tracking-tight sm:text-lg">{t.seasonsRowLabel}</h2>
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
        <div className="absolute inset-0 bg-black/25" />
        {/* Side fade — transparent over the poster (left) so its colour
            still reads as atmosphere, darkening toward the text column
            (right) so title/meta/buttons keep full contrast. Without
            this, darkening enough for the text to read flattened the
            whole band to near-black regardless of the poster's own
            colour — the page read the same shade of navy for every show. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, transparent 34%, rgba(10,16,30,0.72) 60%, rgba(10,16,30,0.92) 100%)',
          }}
        />
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
              // The largest thing above the fold, so it is the one image
              // on this screen worth asking the browser to hurry.
              fetchPriority="high"
              decoding="async"
              width={600}
              height={900}
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
              <Badge tone="mark" onArt icon={<Clock className="h-3 w-3" />} className="absolute left-1.5 top-1.5">
                {t.comingSoonLabel}
              </Badge>
            ) : (
              <>
                {/* The rank moved up beside the "trending" label — the
                    cover is only about 100px wide on a small phone, and
                    rank plus access badge were sitting on top of each
                    other there. Access wins the cover: it is the one
                    that says whether this is watchable. */}
                {/* VIP / Free badge — same subscription status the detail
                    screen enforces, so the cover never over-promises.
                    Skipped on a Coming Soon cover, where neither label
                    means anything until episodes exist. */}
                {/* Three answers, not two. This used to be `free ? FREE :
                    VIP`, which meant a standalone film — bought once for a
                    flat price, not gated behind a membership — was labelled
                    VIP on the one cover the page leads with. Both featured
                    movies in the catalog were mislabelled that way. The
                    order matches ShowCard's, so a title carries the same
                    badge in the hero and in every rail. */}
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
              </>
            )}
          </div>
        </button>

        {/* Title + meta + actions */}
        <div className="min-w-0 flex-1 text-left">
          <span className="relative -top-1 mb-1 flex flex-wrap items-center gap-1.5">
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
            className="cursor-pointer text-lg font-black leading-[1.05] text-white sm:text-2xl"
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
            <p className="mt-0.5 truncate text-[11px] font-semibold text-[#9AA4BD] sm:text-xs">{heroGenre}</p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-white/70 sm:text-xs">
            <span className="flex items-center gap-1 text-[#F5C563]">
              <Star className="h-2.5 w-2.5 fill-[#F5C563] sm:h-3 sm:w-3" /> {Number(hero.rating).toFixed(1)}
            </span>
            {/* Divider and value stay inside one span: on a 320px screen
                this row wraps, and a separator left stranded at the end of
                a line reads as a typo. Only the two plain-text items get a
                divider — the chips below carry their own border, so a pipe
                in front of them is one separator too many. */}
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
            {/* "Ongoing" — same red pill as the Show Detail
                screen, so the cue reads consistently across the app
                instead of inventing a separate style just for the hero.
                Red and not gold: it says the show is still getting
                episodes, which is information, not a premium promise —
                and nothing red in this app is tappable. */}
            {hero.type === 'series' && hero.status !== 'completed' && (
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-accent sm:text-[11px]">
                {t.ongoing}
              </span>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 sm:mt-3.5 sm:gap-2.5">
            {/* Same tap either way — the detail screen is where a Coming
                Soon title explains itself — but the label stops saying
                "Play" for something that cannot be played yet. */}
            <button
              onClick={() => onSelectShow(hero)}
              className="flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[11px] font-bold text-white shadow-[0_4px_16px_rgba(32,80,216,0.4)] transition active:scale-95 sm:px-5 sm:py-2 sm:text-xs"
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
        <div className="rail-scroller no-scrollbar relative z-10 mx-auto mt-3 flex max-w-[1400px] gap-2 overflow-x-auto px-0.5 pb-1 sm:mt-4 sm:gap-2.5">
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
                loading="lazy"
                decoding="async"
                width={600}
                height={900}
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
            // Not blue. Blue in this app means "press me", and a
            // countdown bar is the one thing on the hero that cannot be
            // pressed — it just reports where the carousel has got to.
            style={{
              animationDuration: `${HERO_AUTO_MS}ms`,
              background: 'rgba(255,255,255,0.75)',
            }}
          />
        </div>
      )}
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
      className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 transition ${
        active ? 'text-[#4E86FF]' : highlight ? 'text-[#4E86FF]' : 'text-[#9AA4BD] active:text-white/80'
      }`}
    >
      {active && (
        <span
          className="pointer-events-none absolute inset-x-4 top-0 h-[2px] rounded-full bg-gradient-to-r from-transparent via-[#2050D8] to-transparent"
          aria-hidden
        />
      )}
      <span className="relative">
        {icon}
        {highlight && !active && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#4E86FF] shadow-[0_0_6px_rgba(78,134,255,0.9)]" aria-hidden />
        )}
      </span>
      <span className={`max-w-full truncate px-0.5 text-[9.5px] leading-none ${highlight && !active ? 'font-bold' : 'font-semibold'}`}>{label}</span>
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
      {/* The rule above the row carries the row's colour at its left edge
          and dissolves into nothing — so scrolling the page reads as a
          sequence of coloured openings rather than eleven identical grey
          hairlines. */}
      {!subRow && (
        <div
          className="mb-4 h-px w-full"
          style={{
            background: `linear-gradient(90deg, ${tint(accent, 0.55)} 0%, ${tint(accent, 0.14)} 22%, rgba(255,255,255,0.05) 55%, transparent 100%)`,
          }}
          aria-hidden
        />
      )}
      <div className={`flex items-center justify-between gap-2 ${subRow ? 'mb-1.5 pl-3' : 'mb-3'}`}>
        <div className="flex min-w-0 items-center gap-2">
          {/* The one solid block of the row's colour on the whole screen.
              A sub-row is already inside a titled section, so it drops
              the rule entirely rather than repeating its parent's. */}
          {!subRow && (
            <span
              className="h-4 w-[3px] shrink-0 rounded-sm"
              style={{ background: accent, boxShadow: `0 0 10px ${tint(accent, 0.5)}` }}
              aria-hidden
            />
          )}
          {/* The icon sits in a tile washed with the row's own accent
              (.rail-chip reads --row-accent from this section), so the
              heading anchors the row's colour as one solid block rather
              than a bare glyph floating next to the title. A sub-row is
              already inside a titled section and keeps the bare icon. */}
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
            <h2 className="truncate text-[17px] font-extrabold tracking-tight sm:text-2xl">{title}</h2>
          )}
          {/* The access badge the whole row shares, printed here instead
              of over every poster in it. A row-level `tag` (HOT, SOON)
              still wins the slot when one is set, so the heading never
              carries two chips saying different things. */}
          {tag ? <Badge tone={tag.tone ?? 'info'}>{tag.label}</Badge> : rowAccessBadge}
        </div>
        {/* Icon-only now — every row repeating the same "View All" text
            down the length of a page this long added up to a lot of
            words saying the same thing. The label still exists, just as
            the accessible name instead of visible text. */}
        {onViewAll && (
          <button
            onClick={onViewAll}
            aria-label={viewAllLabel}
            title={viewAllLabel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#9AA4BD] transition hover:bg-white/5 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
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
            titleFromSeason={subRow}
            continuesAtSeason={continuesAt?.[s.id]}
            hideAccessBadge={rowAccess !== null}
          />
        ))}
      </div>
    </section>
  );
}
