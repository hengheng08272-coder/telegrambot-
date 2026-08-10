import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import {
  ArrowLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  SkipBack,
  SkipForward,
  Loader2,
  RotateCcw,
  RotateCw,
  ChevronRight,
  X,
  ListVideo,
  Check,
} from 'lucide-react';
import type { Episode, ShowWithGenres } from '@/lib/types';
import { fetchEpisodesByShow } from '@/lib/api';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import { getCurrentTelegramUser, isInTelegram, enterTelegramFullscreen, exitTelegramFullscreen, isTelegramFullscreen, hasTelegramFullscreenAPI, getTelegramWebApp } from '@/lib/telegram';
import { supabase } from '@/lib/supabase/supabaseClient';

interface VideoPlayerScreenProps {
  episode: Episode;
  show: ShowWithGenres;
  onBack: () => void;
  /** Lets the player switch to another episode of the same show without
   *  leaving fullscreen/the player screen — powers both the manual "Next
   *  Episode" button and end-of-episode auto-advance. Next/prev controls
   *  simply don't render when this isn't provided. */
  onSwitchEpisode?: (episode: Episode) => void;
}

const RESUME_KEY = (episodeId: string) => `nint_resume_${episodeId}`;

function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

export default function VideoPlayerScreen({
  episode,
  show,
  onBack,
  onSwitchEpisode,
}: VideoPlayerScreenProps) {
  const { lang } = useLang();
  const t = appText[lang];
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastSaveRef = useRef(0);
  const tapRef = useRef<{ time: number; side: 'left' | 'right' | null }>({ time: 0, side: null });
  const tapTimeoutRef = useRef<number | null>(null);
  const autoAdvanceTimer = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [seekFlash, setSeekFlash] = useState<{ side: 'left' | 'right'; key: number } | null>(null);
  const [allEpisodes, setAllEpisodes] = useState<Episode[]>([]);
  const [autoAdvanceIn, setAutoAdvanceIn] = useState<number | null>(null);
  const [episodeListOpen, setEpisodeListOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const currentIdx = allEpisodes.findIndex((e) => e.id === episode.id);
  const nextEpisode = currentIdx >= 0 && currentIdx < allEpisodes.length - 1 ? allEpisodes[currentIdx + 1] : null;

  // Keep isFullscreen in sync with reality, not just with what our own
  // button last did — the OS/browser can also exit fullscreen on its own
  // (Android's back button, an ESC key, a swipe-down gesture, iOS's native
  // player "Done" button), and without this the Maximize/Minimize icon and
  // any fullscreen-only UI would silently drift out of sync with what's
  // actually on screen.
  useEffect(() => {
    const syncFullscreen = () => {
      const nativeFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(nativeFs || isTelegramFullscreen());
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    const tg = getTelegramWebApp();
    tg?.onEvent('fullscreenChanged', syncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
      tg?.offEvent('fullscreenChanged', syncFullscreen);
    };
  }, []);

  // If the viewer entered fullscreen (either Telegram's Mini-App-level
  // fullscreen or the browser's own) from the toggle button, leaving this
  // screen shouldn't leave the whole app stuck expanded over Telegram's
  // header, or the browser stuck in fullscreen behind whatever screen
  // comes next — collapse it all back on unmount. Each call is wrapped
  // separately so one failing (e.g. exitFullscreen() rejecting because we
  // were never actually in native fullscreen) never skips the others.
  useEffect(() => {
    return () => {
      try {
        exitTelegramFullscreen();
      } catch {
        /* no-op */
      }
      try {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      } catch {
        /* no-op */
      }
      try {
        (screen as any).orientation?.unlock?.();
      } catch {
        /* no-op */
      }
    };
  }, []);

  // The full episode list, sorted — powers both "next episode" and the
  // in-player episode-switcher panel. Fetched once per show, not per
  // episode, so skipping around doesn't re-fetch on every switch.
  useEffect(() => {
    if (!onSwitchEpisode || show.type === 'movie') return;
    let cancelled = false;
    fetchEpisodesByShow(show.id).then((eps) => {
      if (cancelled) return;
      const sorted = [...eps].sort((a, b) =>
        a.season !== b.season ? a.season - b.season : a.episode_number - b.episode_number
      );
      setAllEpisodes(sorted);
    });
    return () => {
      cancelled = true;
    };
  }, [show.id, show.type, onSwitchEpisode]);

  // No viewer session and no subscription check in this build — the
  // `videos` storage bucket is public, so we just play episode.video_url
  // directly. (No signed-URL edge function needed.)
  useEffect(() => {
    setResolving(true);
    setAccessError('');
    if (episode.video_url) {
      setPlayUrl(episode.video_url);
    } else {
      setAccessError('Video not available yet.');
    }
    setResolving(false);
  }, [episode.id, episode.video_url]);

  // Silent watch-session log — one row per episode open, no visible
  // watermark on the video itself. If content ever leaks, this narrows
  // down who was watching that episode around that time. Fire-and-forget:
  // never blocks playback, and quietly no-ops in a plain browser preview
  // where there's no Telegram identity to attach.
  useEffect(() => {
    const user = getCurrentTelegramUser();
    if (!user) return;
    supabase
      .from('watch_log')
      .insert({
        telegram_user_id: String(user.id),
        telegram_username: user.label,
        show_id: show.id,
        show_title: show.title,
        episode_label: episode.episode_number ? `EP ${episode.episode_number}` : episode.title,
      })
      .then(() => {});
  }, [episode.id, show.id, show.title]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !playUrl) return;

    const url = playUrl;
    setLoadError(false);
    let cancelled = false;

    if (isHls(url)) {
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = url;
        return;
      }
      (async () => {
        try {
          const { default: Hls } = await import('hls.js');
          if (cancelled) return;
          if (Hls.isSupported()) {
            const hls = new Hls({ maxBufferLength: 30 });
            hlsRef.current = hls;
            hls.loadSource(url);
            hls.attachMedia(v);
            hls.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal) setLoadError(true);
            });
          } else {
            setLoadError(true);
          }
        } catch {
          if (!cancelled) setLoadError(true);
        }
      })();
      return () => {
        cancelled = true;
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    } else {
      v.src = url;
    }
  }, [playUrl]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.target.value);
    v.currentTime = t;
    setCurrent(t);
  };

  const skip = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(v.currentTime + delta, 0), v.duration || 0);
  };

  const handleZoneTap = (side: 'left' | 'right') => {
    const now = Date.now();
    const isDouble = now - tapRef.current.time < 300 && tapRef.current.side === side;
    tapRef.current = { time: now, side };

    if (isDouble) {
      if (tapTimeoutRef.current) {
        window.clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
      }
      skip(side === 'left' ? -10 : 10);
      setSeekFlash({ side, key: now });
      window.setTimeout(() => setSeekFlash((f) => (f?.key === now ? null : f)), 550);
    } else {
      // Wait to see if a second tap follows before treating this as a
      // plain single tap — otherwise every double-tap would also toggle
      // play/pause on its first half.
      tapTimeoutRef.current = window.setTimeout(() => {
        togglePlay();
        revealControls();
      }, 260);
    }
  };

  // Auto-advance countdown after an episode ends — ticks down once a
  // second and switches when it hits zero, unless the viewer cancels.
  useEffect(() => {
    if (autoAdvanceIn === null) return;
    if (autoAdvanceIn <= 0) {
      if (nextEpisode && onSwitchEpisode) onSwitchEpisode(nextEpisode);
      return;
    }
    autoAdvanceTimer.current = window.setTimeout(() => setAutoAdvanceIn((n) => (n ?? 1) - 1), 1000);
    return () => {
      if (autoAdvanceTimer.current) window.clearTimeout(autoAdvanceTimer.current);
    };
  }, [autoAdvanceIn, nextEpisode, onSwitchEpisode]);

  // Best-effort landscape lock — only works while genuinely in fullscreen
  // on browsers that support the Screen Orientation API (mainly Android
  // Chrome). iOS Safari and Telegram's own WebView don't support it at
  // all, so every call is wrapped and failures are silently ignored —
  // this is a nice-to-have, never something worth crashing the player over.
  const lockLandscape = () => {
    try {
      (screen as any).orientation?.lock?.('landscape')?.catch?.(() => {});
    } catch {
      /* not supported here — fine, playback still works in portrait */
    }
  };
  const unlockOrientation = () => {
    try {
      (screen as any).orientation?.unlock?.();
    } catch {
      /* no-op */
    }
  };

  // Three layers, tried in order, because "fullscreen" means something
  // different depending on where this is actually running:
  //   1. Inside Telegram, WITH the newer requestFullscreen API — the
  //      browser's own Fullscreen API is blocked by Telegram's WebView
  //      entirely, so this is the only thing that works there. Expands
  //      the whole app over Telegram's header (Bot API 8.0+ clients only).
  //   2. Inside Telegram, WITHOUT that API (older client) — this used to
  //      just silently do nothing. Falls through to try the browser path
  //      below anyway, since Android's Telegram WebView is Chromium-based
  //      and sometimes honors it even though iOS's generally won't.
  //   3. A normal browser outside Telegram entirely — standard Fullscreen
  //      API on the container (Android Chrome, desktop), then iOS
  //      Safari's WebKit-only video fullscreen as the last resort.
  // Every branch is wrapped so a rejected/unsupported call (very common
  // across mobile browsers) just leaves the player as-is instead of
  // throwing and taking the whole screen down.
  const toggleFullscreen = () => {
    try {
      if (isInTelegram() && hasTelegramFullscreenAPI()) {
        if (isTelegramFullscreen()) {
          exitTelegramFullscreen();
          unlockOrientation();
          setIsFullscreen(false);
        } else {
          enterTelegramFullscreen();
          lockLandscape();
          setIsFullscreen(true);
        }
        return;
      }

      const el = containerRef.current;
      const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;

      if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
        (document.exitFullscreen?.() ?? Promise.resolve()).catch(() => {});
        unlockOrientation();
        setIsFullscreen(false);
        return;
      }

      if (el?.requestFullscreen) {
        el
          .requestFullscreen()
          .then(() => {
            setIsFullscreen(true);
            lockLandscape();
          })
          .catch(() => {
            // Standard API rejected (common on iOS, and possible inside
            // Telegram's WebView too) — fall back to the video's own
            // native fullscreen if this WebKit-only method exists.
            try {
              v?.webkitEnterFullscreen?.();
              setIsFullscreen(true);
            } catch {
              /* genuinely unsupported here — leave the player as-is */
            }
          });
      } else if (v?.webkitEnterFullscreen) {
        v.webkitEnterFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      // Never let a fullscreen quirk crash the player screen.
    }
  };

  // Unified handler for every "back" affordance in this screen (the
  // top-left arrow, and the error-state buttons). If we're in fullscreen,
  // the first press only backs out of fullscreen — matching what phones
  // already do with their own hardware/gesture back — so a second press
  // is what actually leaves the player. This also guarantees we never
  // tear the video element out of the DOM while it's still the
  // fullscreen element, which is what left the player in a broken state.
  const handleBackPress = () => {
    if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
      (document.exitFullscreen?.() ?? Promise.resolve()).catch(() => {});
      unlockOrientation();
      setIsFullscreen(false);
      return;
    }
    if (isInTelegram() && isTelegramFullscreen()) {
      exitTelegramFullscreen();
      unlockOrientation();
      setIsFullscreen(false);
      return;
    }
    if (!isInTelegram()) {
      // Consume the history entry pushed when the player opened (below) —
      // that's what fires the popstate handler which actually calls
      // onBack(), keeping the on-screen button and the phone's own back
      // gesture going through one consistent path instead of the button
      // leaving a stray entry in the back-stack.
      window.history.back();
      return;
    }
    onBack();
  };

  const revealControls = () => {
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowControls(false), 3000);
  };

  useEffect(() => {
    revealControls();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  // Outside Telegram (a plain mobile browser tab), there's no app-level
  // BackButton — so without this, a phone's swipe-back gesture or its
  // hardware back button doesn't back out of the player at all, it just
  // leaves the site entirely. Pushing one history entry when the player
  // opens means that gesture instead pops back to this screen first,
  // which we treat exactly like tapping the on-screen back arrow. (Inside
  // Telegram this is skipped — registerBackButtonHandler in App.tsx
  // already owns back navigation there.)
  useEffect(() => {
    if (isInTelegram()) return;
    window.history.pushState({ nintPlayer: true }, '');
    // By the time this fires — from either the phone's own back gesture
    // or our handleBackPress() consuming the pushed entry above — any
    // fullscreen the OS/browser was going to intercept has already been
    // exited on its own, so this just needs to perform the real
    // navigation, not re-check fullscreen or touch history again.
    const handlePopState = () => {
      onBack();
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <div
        ref={containerRef}
        className="relative h-full w-full"
        onMouseMove={revealControls}
        onClick={revealControls}
        onContextMenu={(e) => e.preventDefault()}
      >
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          autoPlay
          playsInline
          controlsList="nodownload noremoteplayback noplaybackrate"
          disablePictureInPicture
          disableRemotePlayback
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const time = e.currentTarget.currentTime;
            setCurrent(time);
            // Save resume position at most once a second — cheap enough
            // that this never needs to be throttled harder than that.
            const now = Date.now();
            if (now - lastSaveRef.current > 1000 && e.currentTarget.duration > 0) {
              lastSaveRef.current = now;
              // Don't bother remembering a position in the last few
              // seconds — that's "finished", not "resume from here".
              if (time > 5 && time < e.currentTarget.duration - 8) {
                localStorage.setItem(RESUME_KEY(episode.id), String(time));
              } else {
                localStorage.removeItem(RESUME_KEY(episode.id));
              }
            }
          }}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            const saved = localStorage.getItem(RESUME_KEY(episode.id));
            const savedTime = saved ? Number(saved) : 0;
            if (savedTime > 5 && savedTime < e.currentTarget.duration - 8) {
              e.currentTarget.currentTime = savedTime;
            }
          }}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onError={() => setLoadError(true)}
          onEnded={() => {
            localStorage.removeItem(RESUME_KEY(episode.id));
            if (nextEpisode && onSwitchEpisode) {
              setAutoAdvanceIn(5);
            }
          }}
        />

        {/* Double-tap left/right to skip ±10s, single tap to toggle play —
            plain onClick can't tell those apart on mobile, so this tracks
            tap timing/side by hand. Sits above the video but below the
            paused-state center button and the top/bottom control bars. */}
        {!resolving && !accessError && !loadError && (
          <div className="absolute inset-0 z-[5] flex">
            <div
              className="h-full w-1/2"
              onClick={() => handleZoneTap('left')}
              aria-hidden
            />
            <div
              className="h-full w-1/2"
              onClick={() => handleZoneTap('right')}
              aria-hidden
            />
          </div>
        )}

        {/* Brief ±10s flash on double-tap */}
        {seekFlash && (
          <div
            key={seekFlash.key}
            className={`pointer-events-none absolute top-1/2 z-[6] flex -translate-y-1/2 items-center gap-1 rounded-full bg-black/50 px-4 py-3 text-white seek-flash-pop ${
              seekFlash.side === 'left' ? 'left-[12%]' : 'right-[12%]'
            }`}
          >
            {seekFlash.side === 'left' ? (
              <RotateCcw className="h-6 w-6" />
            ) : (
              <RotateCw className="h-6 w-6" />
            )}
            <span className="text-xs font-bold">10s</span>
          </div>
        )}

        {/* Resolving playback URL */}
        {resolving && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="h-8 w-8 animate-spin text-[#E31E24]" />
          </div>
        )}

        {/* Access denied (not subscribed, etc.) */}
        {!resolving && accessError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black text-center">
            <p className="max-w-xs text-sm font-semibold text-white">{accessError}</p>
            <button
              onClick={handleBackPress}
              className="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
            >
              {t.goBack}
            </button>
          </div>
        )}

        {/* Buffering spinner */}
        {buffering && !loadError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-[#E31E24]" />
          </div>
        )}

        {/* Load error */}
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="h-8 w-8 text-[#E31E24]" />
            <p className="text-sm font-semibold text-white">{t.unableToLoadVideo}</p>
            <p className="max-w-xs text-xs text-white/50">
              {t.videoMissingHint}
            </p>
            <button
              onClick={handleBackPress}
              className="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
            >
              {t.goBack}
            </button>
          </div>
        )}

        {/* Top gradient + back */}
        <div
          className={`absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/80 to-transparent p-4 transition-opacity duration-300 sm:p-6 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            onClick={handleBackPress}
            className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition hover:bg-black/60"
          >
            <ArrowLeft className="h-4 w-4" /> {t.back}
          </button>
        </div>

        {/* Title overlay */}
        <div
          className={`absolute left-4 top-16 z-10 max-w-lg transition-opacity duration-300 sm:left-6 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <p className="text-xs font-medium uppercase tracking-wider text-[#E31E24]">
            {show.title}
          </p>
          <h2 className="mt-1 text-xl font-bold text-white">
            {show.type === 'movie' ? show.title : `${t.episodeLabel} ${episode.episode_number}: ${episode.title}`}
          </h2>
        </div>

        {/* Center play/pause when paused */}
        {!playing && !buffering && !loadError && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 z-10 flex items-center justify-center"
            aria-label="Play"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#E31E24]/90 shadow-[0_0_40px_rgba(227,30,36,0.5)] transition hover:scale-110">
              <Play className="h-9 w-9 fill-white text-white" />
            </div>
          </button>
        )}

        {/* Bottom controls */}
        <div
          className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 pt-12 transition-opacity duration-300 sm:px-6 sm:pb-6 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Seek bar */}
          <div className="mb-3 flex items-center gap-3">
            <span className="w-12 text-right font-mono text-xs text-white/70">
              {fmtTime(current)}
            </span>
            <div className="group relative flex-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-[#E31E24] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={current}
                onChange={seek}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Seek"
              />
            </div>
            <span className="w-12 font-mono text-xs text-white/70">
              {fmtTime(duration)}
            </span>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={togglePlay}
              className="text-white transition hover:text-[#E31E24]"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="h-6 w-6 fill-white" /> : <Play className="h-6 w-6 fill-white" />}
            </button>
            <button
              onClick={() => skip(-10)}
              className="text-white/80 transition hover:text-[#E31E24]"
              aria-label="Back 10s"
            >
              <SkipBack className="h-5 w-5" />
            </button>
            <button
              onClick={() => skip(10)}
              className="text-white/80 transition hover:text-[#E31E24]"
              aria-label="Forward 10s"
            >
              <SkipForward className="h-5 w-5" />
            </button>
            <button
              onClick={toggleMute}
              className="text-white/80 transition hover:text-[#E31E24]"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <div className="ml-auto flex items-center gap-4">
              {allEpisodes.length > 0 && onSwitchEpisode && (
                <button
                  onClick={() => setEpisodeListOpen(true)}
                  className="text-white/80 transition hover:text-[#E31E24]"
                  aria-label="Episode list"
                >
                  <ListVideo className="h-5 w-5" />
                </button>
              )}
              {nextEpisode && onSwitchEpisode && (
                <button
                  onClick={() => onSwitchEpisode(nextEpisode)}
                  className="flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/20"
                  aria-label="Next episode"
                >
                  {t.episodeLabel} {nextEpisode.episode_number} <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className="text-white/80 transition hover:text-[#E31E24]"
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* End-of-episode auto-advance prompt */}
        {autoAdvanceIn !== null && nextEpisode && (
          <div className="absolute bottom-24 right-4 z-20 flex w-64 items-center gap-3 rounded-2xl border border-white/10 bg-[#170D0C]/95 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.6)] backdrop-blur-md sm:right-6">
            <img
              src={nextEpisode.thumbnail_url ?? show.poster_url ?? ''}
              alt=""
              className="h-14 w-14 shrink-0 rounded-lg object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">
                {t.episodeLabel} {nextEpisode.episode_number}: {nextEpisode.title}
              </p>
              <p className="text-[11px] text-white/50">
                {t.upNext} · {autoAdvanceIn}s
              </p>
            </div>
            <button
              onClick={() => setAutoAdvanceIn(null)}
              className="shrink-0 rounded-full bg-white/10 p-1.5 text-white/60 transition hover:bg-white/20"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* In-player episode switcher — a bottom sheet so viewers never
            have to leave the player (and lose their place) just to pick a
            different episode. Reuses the same episode list fetched for
            "next episode". */}
        {episodeListOpen && (
          <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={() => setEpisodeListOpen(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#120A09] p-4 pb-6"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">{show.title}</h3>
                <button
                  onClick={() => setEpisodeListOpen(false)}
                  className="rounded-full bg-white/10 p-1.5 text-white/60 transition hover:bg-white/20"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {allEpisodes.map((ep) => {
                  const isCurrent = ep.id === episode.id;
                  return (
                    <button
                      key={ep.id}
                      onClick={() => {
                        setEpisodeListOpen(false);
                        if (!isCurrent) onSwitchEpisode?.(ep);
                      }}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                        isCurrent
                          ? 'border-[#E31E24]/40 bg-[#E31E24]/10'
                          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'
                      }`}
                    >
                      <img
                        src={ep.thumbnail_url ?? show.poster_url ?? ''}
                        alt=""
                        className="h-12 w-20 shrink-0 rounded-lg object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-white">
                          {t.episodeLabel} {ep.episode_number}: {ep.title}
                        </p>
                        {ep.duration && (
                          <p className="text-[10px] text-white/40">{ep.duration} min</p>
                        )}
                      </div>
                      {isCurrent && <Check className="h-4 w-4 shrink-0 text-[#E31E24]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
