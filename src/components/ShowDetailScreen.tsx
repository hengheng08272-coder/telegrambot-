import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Play,
  Star,
  Eye,
  Plus,
  Calendar,
  Building2,
  Clock,
  ChevronRight,
  Lock,
} from 'lucide-react';
import type { Show, ShowWithGenres, Episode } from '@/lib/types';
import { fetchShowById, fetchEpisodesByShow } from '@/lib/api';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface ShowDetailScreenProps {
  show: Show;
  onBack: () => void;
  onPlayEpisode: (episode: Episode, show: ShowWithGenres) => void;
  subscribed: boolean;
}

export default function ShowDetailScreen({
  show,
  onBack,
  onPlayEpisode,
  subscribed,
}: ShowDetailScreenProps) {
  const { lang } = useLang();
  const t = appText[lang];
  const [detail, setDetail] = useState<ShowWithGenres | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [d, eps] = await Promise.all([
          fetchShowById(show.id),
          fetchEpisodesByShow(show.id),
        ]);
        if (!active) return;
        setDetail(d);
        setEpisodes(eps);
      } catch (e: unknown) {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Failed to load show');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [show.id]);

  const fmtDuration = (mins: number | null) =>
    mins ? `${Math.floor(mins / 60) > 0 ? Math.floor(mins / 60) + 'h ' : ''}${mins % 60}m` : '';

  const fmtViews = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      {/* Back bar */}
      <button
        onClick={onBack}
        className="fixed left-4 top-4 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-black/50 px-4 py-2 text-sm font-medium text-white/80 backdrop-blur-md transition hover:bg-black/70 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> {t.back}
      </button>

      {/* Banner */}
      <div className="relative h-[56vh] min-h-[380px] w-full">
        <img
          src={show.banner_url ?? show.poster_url ?? ''}
          alt={show.title}
          className="h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(10,10,15,0.85) 0%, rgba(10,10,15,0.4) 50%, rgba(10,10,15,0.2) 100%), linear-gradient(0deg, rgba(10,10,15,1) 0%, rgba(10,10,15,0) 45%)',
          }}
        />
      </div>

      {/* Detail content overlapping banner */}
      <div className="relative z-10 mx-auto -mt-40 max-w-[1200px] px-4 pb-20 sm:px-8">
        <div className="flex flex-col gap-8 md:flex-row">
          {/* Poster */}
          <div className="hidden md:block">
            <img
              src={show.poster_url ?? ''}
              alt={show.title}
              className="w-56 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
            />
          </div>

          {/* Info */}
          <div className="flex-1">
            <h1
              className="text-4xl font-black leading-tight sm:text-5xl"
              style={{ fontFamily: '"Bebas Neue", Battambang, Inter, sans-serif', letterSpacing: '0.02em' }}
            >
              {show.title.toUpperCase()}
            </h1>

            {/* Meta row */}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="flex items-center gap-1 font-semibold text-[#E8A94A]">
                <Star className="h-4 w-4 fill-[#E8A94A]" /> {Number(show.rating).toFixed(1)}
              </span>
              {!!show.view_count && (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/30" />
                  <span className="flex items-center gap-1 text-white/70">
                    <Eye className="h-4 w-4" /> {fmtViews(show.view_count)}
                  </span>
                </>
              )}
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span className="flex items-center gap-1 text-white/70">
                <Calendar className="h-4 w-4" /> {show.release_year ?? '—'}
              </span>
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span className="rounded border border-white/20 px-2 py-0.5 text-xs font-medium uppercase text-white/70">
                {show.type === 'movie' ? t.movie : t.series}
              </span>
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  show.status === 'ongoing'
                    ? 'bg-[#22C55E]/15 text-[#22C55E]'
                    : 'bg-white/10 text-white/60'
                }`}
              >
                {show.status === 'ongoing' ? t.ongoing : t.completed}
              </span>
            </div>

            {/* Genres */}
            {detail?.genres && detail.genres.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {detail.genres.map((g) => (
                  <span
                    key={g.id}
                    className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/70 ring-1 ring-white/10"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            {/* Synopsis */}
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/70">
              {show.synopsis}
            </p>

            {/* Studio */}
            {show.studio && (
              <p className="mt-4 flex items-center gap-2 text-sm text-white/50">
                <Building2 className="h-4 w-4" /> {t.studio} {show.studio}
              </p>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => {
                  if (episodes.length > 0 && detail) onPlayEpisode(episodes[0], detail);
                }}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0F8F72] to-[#0B6E58] px-7 py-3 text-sm font-bold text-white shadow-[0_10px_30px_rgba(15,143,114,0.35)] transition hover:shadow-[0_14px_40px_rgba(15,143,114,0.5)] active:scale-95"
              >
                <Play className="h-5 w-5 fill-white" />
                {show.type === 'movie' ? t.playMovie : t.playFirstEpisode}
              </button>
              <button className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/20">
                <Plus className="h-5 w-5" /> {t.myList}
              </button>
            </div>
          </div>
        </div>

        {/* Episodes */}
        {show.type !== 'movie' && (
          <div className="mt-12">
            <h2 className="mb-4 text-xl font-bold">{t.episodesHeading}</h2>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-xl bg-[#1E1E2A]" />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm text-[#EF4444]">{error}</p>
            ) : episodes.length === 0 ? (
              <p className="text-sm text-white/40">{t.noEpisodes}</p>
            ) : (
              <div className="space-y-3">
                {episodes.map((ep) => {
                  const locked = !subscribed && !ep.is_free_preview;
                  return (
                  <button
                    key={ep.id}
                    onClick={() => detail && onPlayEpisode(ep, detail)}
                    className={`group flex w-full items-center gap-4 overflow-hidden rounded-xl border p-3 text-left transition ${
                      locked
                        ? 'border-[#E8A94A]/25 bg-[#1A1710] hover:border-[#E8A94A]/60 hover:shadow-[0_0_24px_rgba(232,169,74,0.18)]'
                        : 'border-white/5 bg-[#14141C] hover:border-[#0F8F72]/30 hover:bg-[#1E1E2A]'
                    }`}
                  >
                    <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg sm:w-48">
                      <img
                        src={ep.thumbnail_url ?? show.banner_url ?? ''}
                        alt={ep.title}
                        loading="lazy"
                        className={`h-full w-full object-cover transition group-hover:scale-105 ${
                          locked ? 'brightness-[0.45]' : ''
                        }`}
                      />
                      {locked ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/20">
                          <div
                            className="flex h-10 w-10 items-center justify-center rounded-full transition group-hover:scale-110"
                            style={{
                              background: 'linear-gradient(145deg, #F3CD82 0%, #E8A94A 45%, #A85D1F 100%)',
                              boxShadow: '0 0 18px rgba(232,169,74,0.55)',
                            }}
                          >
                            <Lock className="h-4 w-4 text-[#3A2A00]" strokeWidth={2.5} />
                          </div>
                          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[#E8A94A]">
                            {t.lockedVip}
                          </span>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0F8F72]">
                            <Play className="h-4 w-4 fill-white text-white" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white/50">
                          {t.epShort} {ep.episode_number}
                        </span>
                        {ep.duration && (
                          <span className="flex items-center gap-1 text-xs text-white/40">
                            <Clock className="h-3 w-3" /> {fmtDuration(ep.duration)}
                          </span>
                        )}
                        {ep.is_free_preview && (
                          <span className="rounded-full bg-[#22C55E]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#22C55E]">
                            Free
                          </span>
                        )}
                        {locked && (
                          <span
                            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#3A2A00]"
                            style={{ background: 'linear-gradient(90deg,#E8A94A,#C97A2E)' }}
                          >
                            <Lock className="h-2.5 w-2.5" /> {t.lockedVip}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-0.5 truncate text-base font-semibold text-white transition group-hover:text-[#0F8F72]">
                        {ep.title}
                      </h3>
                      <p className="mt-1 line-clamp-1 text-sm text-white/50">
                        {locked ? t.lockedUnlockHint : ep.description}
                      </p>
                    </div>
                    <ChevronRight className="hidden h-5 w-5 shrink-0 text-white/30 transition group-hover:text-[#0F8F72] sm:block" />
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
