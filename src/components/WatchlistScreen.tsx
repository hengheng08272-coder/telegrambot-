import { useState } from 'react';
import { Play, Bookmark, Clock, Trash2, Search as SearchIcon, ArrowLeft } from 'lucide-react';
import type { Show } from '@/lib/types';
import {
  getWatchlist,
  removeFromWatchlist,
  getContinueWatching,
  clearContinueWatching,
} from '@/lib/watchlist';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import LanguageSwitcher from '@/components/LanguageSwitcher';

interface WatchlistScreenProps {
  onSelectShow: (show: Show) => void;
  onBack: () => void;
  onResumeEpisode: (show: Show, episodeId: string) => void;
}

export default function WatchlistScreen({
  onSelectShow,
  onBack,
  onResumeEpisode,
}: WatchlistScreenProps) {
  const { lang, setLang } = useLang();
  const t = appText[lang];
  const [watchlist, setWatchlist] = useState<Show[]>(() => getWatchlist());
  const [continueItems, setContinueItems] = useState(() => getContinueWatching());

  const handleRemove = (id: string) => {
    removeFromWatchlist(id);
    setWatchlist(getWatchlist());
  };

  const handleClearContinue = (id: string) => {
    clearContinueWatching(id);
    setContinueItems(getContinueWatching());
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-50 bg-[#0A0A0F]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-4 sm:px-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/[0.08] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> {t.back}
          </button>
          <h1
            className="text-xl font-black tracking-wider"
            style={{ fontFamily: '"Bebas Neue", "Battambang", Inter, sans-serif' }}
          >
            {t.watchlistTitle}
          </h1>
          <LanguageSwitcher lang={lang} onChange={setLang} className="hidden sm:flex" />
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 pb-28 pt-24 sm:px-8 sm:pb-12">
        {/* Continue watching */}
        <section className="mt-4">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-5 w-5 text-[#E8A94A]" />
            <h2 className="text-lg font-bold tracking-tight">{t.continueWatching}</h2>
          </div>
          {continueItems.length === 0 ? (
            <p className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-8 text-center text-sm text-white/40">
              {t.continueEmpty}
            </p>
          ) : (
            <div className="space-y-3">
              {continueItems.map((item) => (
                <div
                  key={item.show.id}
                  className="group flex items-center gap-4 overflow-hidden rounded-xl border border-white/5 bg-[#14141C] p-3"
                >
                  <button
                    onClick={() =>
                      onResumeEpisode(item.show, item.episode.id)
                    }
                    className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg sm:w-48"
                  >
                    <img
                      src={item.episode.thumbnail_url ?? item.show.banner_url ?? ''}
                      alt={item.episode.title}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 transition group-hover:bg-black/30">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0F8F72]">
                        <Play className="h-4 w-4 fill-white text-white" />
                      </div>
                    </div>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {item.show.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-white/50">
                      {t.epShort} {item.episode.episode_number} · {item.episode.title}
                    </p>
                    <button
                      onClick={() => onResumeEpisode(item.show, item.episode.id)}
                      className="mt-2 flex items-center gap-1.5 rounded-full bg-[#0F8F72] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#0B6E58] active:scale-95"
                    >
                      <Play className="h-3 w-3 fill-white" /> {t.resume}
                    </button>
                  </div>
                  <button
                    onClick={() => handleClearContinue(item.show.id)}
                    className="shrink-0 rounded-full p-2 text-white/30 transition hover:text-[#0F8F72]"
                    aria-label={t.removeFromList}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Want to watch */}
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <Bookmark className="h-5 w-5 text-[#0F8F72]" />
            <h2 className="text-lg font-bold tracking-tight">{t.wantToWatch}</h2>
          </div>
          {watchlist.length === 0 ? (
            <p className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-8 text-center text-sm text-white/40">
              {t.watchlistEmpty}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {watchlist.map((s) => (
                <div key={s.id} className="group relative">
                  <button
                    onClick={() => onSelectShow(s)}
                    className="block w-full text-left"
                  >
                    <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-[#1E1E2A] ring-1 ring-white/5">
                      <img
                        src={s.poster_url ?? ''}
                        alt={s.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            'linear-gradient(180deg, rgba(10,10,15,0) 50%, rgba(10,10,15,0.9) 100%)',
                        }}
                      />
                    </div>
                    <h3 className="mt-2 truncate text-sm font-semibold text-white">
                      {s.title}
                    </h3>
                  </button>
                  <button
                    onClick={() => handleRemove(s.id)}
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white/70 backdrop-blur-sm transition hover:text-[#0F8F72]"
                    aria-label={t.removeFromList}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Empty state search hint */}
        {watchlist.length === 0 && continueItems.length === 0 && (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] px-6 py-10 text-center">
            <SearchIcon className="h-8 w-8 text-white/20" />
            <p className="text-sm text-white/40">
              {t.watchlistEmpty}
            </p>
            <button
              onClick={onBack}
              className="mt-2 rounded-full bg-[#0F8F72] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#0B6E58] active:scale-95"
            >
              {t.navHome}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
