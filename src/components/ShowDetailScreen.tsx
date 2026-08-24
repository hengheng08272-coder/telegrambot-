import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Play,
  Star,
  Eye,
  Calendar,
  Building2,
  Clock,
  ChevronRight,
  Lock,
  UserPlus,
} from 'lucide-react';
import type { Show, ShowWithGenres, Episode } from '@/lib/types';
import { fetchShowById, fetchEpisodesByShow, fetchAllShows } from '@/lib/api';
import ShowCard from '@/components/ShowCard';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import { inviteFriend, isInTelegram } from '@/lib/telegram';
import { fmtViews } from '@/lib/format';

interface ShowDetailScreenProps {
  show: Show;
  onBack: () => void;
  onPlayEpisode: (episode: Episode, show: ShowWithGenres) => void;
  onSelectShow?: (show: Show) => void;
  subscribed: boolean;
  /** show_ids of standalone movies this viewer has already bought — VIP
   *  does not cover these, purchase is the only way in (see App.tsx). */
  purchasedMovieIds?: Set<string>;
  /** Opens the $1 purchase modal for this show. Only relevant when
   *  show.type === 'movie' && !show.is_free && not already purchased. */
  onRequestPurchase?: (show: Show) => void;
}

export default function ShowDetailScreen({
  show,
  onBack,
  onPlayEpisode,
  onSelectShow,
  subscribed,
  purchasedMovieIds,
  onRequestPurchase,
}: ShowDetailScreenProps) {
  const { lang } = useLang();
  const t = appText[lang];
  const [detail, setDetail] = useState<ShowWithGenres | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [related, setRelated] = useState<ShowWithGenres[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteState, setInviteState] = useState<'idle' | 'sent'>('idle');

  const handleInvite = async () => {
    const result = await inviteFriend();
    if (result === 'shared' || result === 'copied') {
      setInviteState('sent');
      window.setTimeout(() => setInviteState('idle'), 2000);
    }
  };

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

  // "You might also like" — anything sharing at least one genre with this
  // show, current one excluded. Reuses the same fetchAllShows() the home
  // screen already calls, so there's no new API surface to maintain.
  useEffect(() => {
    if (!detail?.genres?.length) return;
    let active = true;
    const genreIds = new Set(detail.genres.map((g) => g.id));
    fetchAllShows().then((all) => {
      if (!active) return;
      const matches = all
        .filter((s) => s.id !== show.id && s.genres?.some((g) => genreIds.has(g.id)))
        .slice(0, 12);
      setRelated(matches);
    });
    return () => {
      active = false;
    };
  }, [detail?.genres, show.id]);

  const fmtDuration = (mins: number | null) =>
    mins ? `${Math.floor(mins / 60) > 0 ? Math.floor(mins / 60) + 'h ' : ''}${mins % 60}m` : '';

  // Standalone movies are gated on purchase only — never on `subscribed`,
  // by design (VIP does not include pay-per-title movies). See App.tsx's
  // handlePlayEpisode for the same rule enforced server-side of the tap.
  const movieLocked =
    show.type === 'movie' && !show.is_free && !purchasedMovieIds?.has(show.id);

  return (
    <div className="min-h-screen bg-app text-white">
      {/* Back bar — Telegram's own native BackButton (registered in
          App.tsx) already handles this when actually inside Telegram, so
          this on-screen fallback only renders outside it (plain browser
          testing), avoiding the visual overlap with Telegram's own back
          pill that showing both caused. */}
      {!isInTelegram() && (
        <button
          onClick={onBack}
          className="glass fixed left-4 top-4 z-50 flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white/80 transition hover:text-white"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
        >
          <ArrowLeft className="h-4 w-4" /> {t.back}
        </button>
      )}

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
              'linear-gradient(90deg, rgba(10,16,30,0.85) 0%, rgba(10,16,30,0.4) 50%, rgba(10,16,30,0.2) 100%), linear-gradient(0deg, rgba(10,16,30,1) 0%, rgba(10,16,30,0) 45%)',
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
              className="w-56 rounded-card shadow-elevated ring-1 ring-white/10"
            />
          </div>

          {/* Info */}
          <div className="flex-1">
            <h1
              className="text-2xl font-black leading-tight sm:text-3xl"
              style={{ fontFamily: '"Anton", Battambang, Inter, sans-serif', letterSpacing: '0.02em' }}
            >
              {show.title.toUpperCase()}
            </h1>

            {/* Meta row */}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="flex items-center gap-1 font-semibold text-[#F5C563]">
                <Star className="h-4 w-4 fill-[#F5C563]" /> {Number(show.rating).toFixed(1)}
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
              {movieLocked && (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/30" />
                  <span className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-[#211A0E]" style={{ background: 'linear-gradient(90deg,#F5C563,#C08F33)' }}>
                    <Lock className="h-3 w-3" /> {t.lockedMovie ?? 'Buy to Watch'} · $1
                  </span>
                </>
              )}
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  show.status === 'ongoing'
                    ? 'bg-[#F5C563]/15 text-[#F5C563]'
                    : 'bg-white/10 text-[#9AA4BD]'
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
                    className="rounded-xl bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/70 ring-1 ring-white/10"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            {/* Studio */}
            {show.studio && (
              <p className="mt-5 flex items-center gap-2 text-sm text-[#9AA4BD]">
                <Building2 className="h-4 w-4" /> {t.studio} {show.studio}
              </p>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => {
                  if (show.coming_soon) return;
                  if (movieLocked) {
                    onRequestPurchase?.(show);
                    return;
                  }
                  if (episodes.length > 0 && detail) onPlayEpisode(episodes[0], detail);
                }}
                disabled={show.coming_soon}
                className={`flex items-center gap-2 rounded-xl px-7 py-3 text-sm font-bold transition active:scale-95 ${
                  show.coming_soon
                    ? 'cursor-not-allowed bg-white/10 text-[#9AA4BD]'
                    : movieLocked
                      ? 'bg-gradient-to-r from-[#F5C563] to-[#C08F33] text-[#211A0E] shadow-[0_8px_20px_-8px_rgba(245,197,99,0.5)]'
                      : 'btn-primary'
                }`}
              >
                {movieLocked ? <Lock className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
                {show.coming_soon
                  ? t.comingSoonLabel
                  : movieLocked
                    ? `${t.buyThisMovie ?? 'Buy This Movie'} — $1`
                    : show.type === 'movie'
                      ? t.playMovie
                      : t.playFirstEpisode}
              </button>
              <button
                onClick={handleInvite}
                className="glass flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white transition hover:bg-white/[0.14] active:scale-95"
                aria-label={t.inviteFriend ?? 'Invite a friend'}
              >
                <UserPlus className="h-4 w-4" />
                {inviteState === 'sent' ? t.linkCopied ?? 'Sent!' : t.inviteFriend ?? 'Invite a friend'}
              </button>
            </div>
          </div>
        </div>

        {/* Trailer — a short preview clip the admin can attach per show,
            most useful for completed series where there's no "currently
            airing" hook to pull a viewer in. Sits below the main info
            panel, above the episode list. */}
        {show.trailer_url && (
          <div className="mt-10">
            <h2 className="mb-3 text-lg font-bold">{t.trailerHeading ?? 'Trailer'}</h2>
            <video
              key={show.trailer_url}
              src={show.trailer_url}
              controls
              playsInline
              poster={show.banner_url ?? show.poster_url ?? undefined}
              className="w-full max-w-2xl rounded-card bg-black shadow-elevated ring-1 ring-white/10"
            />
          </div>
        )}

        {/* Episodes */}
        {show.type !== 'movie' && (
          <div className="mt-12">
            <h2 className="mb-4 text-xl font-bold">{t.episodesHeading}</h2>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton-shimmer h-24 rounded-card bg-[#151926]" />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm text-[#FF6B60]">{error}</p>
            ) : episodes.length === 0 ? (
              <p className="text-sm text-[#6A7591]">
                {show.coming_soon ? `🎬 ${t.comingSoonLabel}` : t.noEpisodes}
              </p>
            ) : (
              <div className="space-y-3">
                {episodes.map((ep) => {
                  const locked = !subscribed && !ep.is_free_preview;
                  return (
                  <button
                    key={ep.id}
                    onClick={() => detail && onPlayEpisode(ep, detail)}
                    className={`group flex w-full items-center gap-4 overflow-hidden rounded-card border p-3 text-left shadow-card transition active:scale-[0.995] ${
                      locked
                        ? 'border-[#F5C563]/25 bg-[#1A1710] hover:border-[#F5C563]/60 hover:shadow-glow-gold'
                        : 'border-white/[0.06] bg-[#0E1017] hover:border-[#2050D8]/35 hover:bg-[#151926]'
                    }`}
                  >
                    <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-xl sm:w-48">
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
                              background: 'linear-gradient(145deg, #F8DCA0 0%, #F5C563 45%, #8F6425 100%)',
                              boxShadow: '0 0 18px rgba(245,197,99,0.55)',
                            }}
                          >
                            <Lock className="h-4 w-4 text-[#211A0E]" strokeWidth={2.5} />
                          </div>
                          <span className="rounded-md bg-black/60 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-[#F5C563]">
                            {t.lockedVip}
                          </span>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-gradient shadow-[0_0_24px_rgba(32,80,216,0.55)]">
                            <Play className="h-4 w-4 fill-white text-white" />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#9AA4BD]">
                          {t.epShort} {ep.episode_number}
                        </span>
                        {ep.duration && (
                          <span className="flex items-center gap-1 text-xs text-[#6A7591]">
                            <Clock className="h-3 w-3" /> {fmtDuration(ep.duration)}
                          </span>
                        )}
                        {locked && (
                          <span
                            className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#211A0E]"
                            style={{ background: 'linear-gradient(90deg,#F5C563,#C08F33)' }}
                          >
                            <Lock className="h-2.5 w-2.5" /> {t.lockedVip}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-0.5 truncate text-base font-semibold text-white transition group-hover:text-[#4E86FF]">
                        {ep.title}
                      </h3>
                      <p className="mt-1 line-clamp-1 text-sm text-[#9AA4BD]">
                        {locked ? t.lockedUnlockHint : ep.description}
                      </p>
                    </div>
                    <ChevronRight className="hidden h-5 w-5 shrink-0 text-[#6A7591] transition group-hover:text-[#2050D8] sm:block" />
                  </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* You might also like — same genre pool, current show excluded */}
        {related.length > 0 && (
          <div className="mt-12">
            <h2 className="mb-4 text-xl font-bold">{t.relatedShows ?? 'You might also like'}</h2>
            <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
              {related.map((s) => (
                <ShowCard key={s.id} show={s} onClick={(sel) => onSelectShow?.(sel)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
