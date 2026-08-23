import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import {
  ArrowLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Lock,
  Loader2,
  RotateCcw,
  RotateCw,
  ChevronRight,
  X,
  ListVideo,
  Check,
  Maximize,
  Minimize,
  Gauge,
  Crop,
  MoreVertical,
  AlertTriangle,
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
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function fmtTime(sec: number) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isHls(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

/* Vendor-prefixed halves of the Fullscreen API. Safari (desktop, and on
   iOS the <video> element only) still ships the webkit spelling, which the
   standard DOM typings don't know about — these narrow types keep the
   fallbacks type-safe instead of casting to `any` at every call site. */
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  /** iOS Safari: the only fullscreen it allows, and only on <video>. */
  webkitEnterFullscreen?: () => void;
};
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type OrientationLock = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

function nativeFullscreenElement(): Element | null {
  const d = document as FsDocument;
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
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
  /* One-shot guard for the "first touch takes you fullscreen" behaviour
     below, plus a note of whether the viewer left fullscreen deliberately —
     in which case we never drag them back into it. */
  const autoFsTriedRef = useRef(false);
  const userExitedFsRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
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
  const [locked, setLocked] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Lock, speed, fit/fill, and the full episode list are all "set once,
  // rarely touched again" controls — grouped behind one overflow sheet
  // instead of four separate icons crowding the bottom bar.
  const [moreOpen, setMoreOpen] = useState(false);
  const [fillScreen, setFillScreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const currentIdx = allEpisodes.findIndex((e) => e.id === episode.id);
  const nextEpisode = currentIdx >= 0 && currentIdx < allEpisodes.length - 1 ? allEpisodes[currentIdx + 1] : null;

  /* ── Fullscreen ──────────────────────────────────────────────────────
     "Fullscreen" here is three mechanisms applied together, because no
     single one covers every surface this app runs on:
       1. Telegram's Mini-App fullscreen (Bot API 8.0+) — the only way out
          from under Telegram's own header inside the client.
       2. The browser Fullscreen API on the player container — what a plain
          mobile/desktop browser tab responds to. iOS Safari refuses it on
          anything but the <video> element, so that's the fallback there.
       3. A landscape orientation lock, so a phone held upright still fills
          the screen with picture instead of a letterboxed strip.
     Each is wrapped separately: one being unsupported must never stop the
     others from applying. */
  const lockLandscape = () => {
    try {
      void (screen.orientation as OrientationLock | undefined)?.lock?.('landscape')?.catch?.(() => {});
    } catch {
      /* unsupported here (iOS Safari, Telegram WebView) — playback is fine without it */
    }
  };
  const unlockOrientation = () => {
    try {
      (screen.orientation as OrientationLock | undefined)?.unlock?.();
    } catch {
      /* no-op */
    }
  };

  const enterFullscreen = async () => {
    if (isInTelegram() && hasTelegramFullscreenAPI()) {
      try {
        enterTelegramFullscreen();
      } catch {
        /* older Telegram client — the browser path below still applies */
      }
    }
    const el = containerRef.current as FsElement | null;
    try {
      if (el?.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } else if (el?.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else {
        (videoRef.current as FsElement | null)?.webkitEnterFullscreen?.();
      }
    } catch {
      /* Denied — usually "not called from a user gesture", or a WebView
         with fullscreen disabled. The Telegram expansion and the landscape
         lock still give a full-bleed picture, so this is never fatal. */
    }
    lockLandscape();
    setIsFullscreen(true);
    // One tap should give a clear, edge-to-edge picture without a second
    // trip to the crop toggle — fill is what actually removes the black
    // bars a landscape phone would otherwise show. Still overridable from
    // the More sheet if the viewer prefers the letterboxed original frame.
    setFillScreen(true);
  };

  const leaveFullscreen = async () => {
    const d = document as FsDocument;
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (d.webkitFullscreenElement && d.webkitExitFullscreen) {
        await d.webkitExitFullscreen();
      }
    } catch {
      /* no-op */
    }
    if (isInTelegram() && isTelegramFullscreen()) {
      try {
        exitTelegramFullscreen();
      } catch {
        /* no-op */
      }
    }
    unlockOrientation();
    setIsFullscreen(false);
    // Fill is a fullscreen-only convenience — back in the windowed view,
    // showing the untouched frame (no crop) is the more expected default.
    setFillScreen(false);
  };

  const toggleFullscreen = () => {
    if (isFullscreen) {
      userExitedFsRef.current = true;
      void leaveFullscreen();
    } else {
      userExitedFsRef.current = false;
      void enterFullscreen();
    }
  };

  // Keep isFullscreen in sync with reality — Telegram can collapse its own
  // fullscreen (Android back button, a swipe) and a browser exits on Esc,
  // neither of which routes through our button.
  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(!!nativeFullscreenElement() || isTelegramFullscreen());
      // Coming back from the phone's own fullscreen player (iOS takes
      // over <video> entirely there), our chrome has usually timed out
      // while we were away — so the viewer lands on a bare black video
      // with no visible way back and has to guess that tapping does
      // something. Put the controls up on every fullscreen transition.
      setShowControls(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setShowControls(false), 3400);
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

  // Auto-expand over Telegram's own header the moment the player opens, so
  // Telegram's back pill/menu stops overlapping our own top bar. The
  // browser Fullscreen API can't be requested here — there's been no user
  // gesture yet — which is what the first-touch handler below is for.
  useEffect(() => {
    if (isInTelegram() && hasTelegramFullscreenAPI()) {
      try {
        enterTelegramFullscreen();
      } catch {
        /* no-op — falls back to the plain in-page layout, still usable */
      }
    }
  }, []);

  // Browsers only grant fullscreen from inside a user gesture, so the
  // viewer's first touch on the player is what actually takes them there.
  // It fires once; if they then leave fullscreen on purpose, that's
  // remembered and we never pull them back in.
  const maybeAutoFullscreen = () => {
    if (autoFsTriedRef.current || userExitedFsRef.current) return;
    autoFsTriedRef.current = true;
    if (nativeFullscreenElement()) return;
    void enterFullscreen();
  };

  // Rotating the phone to landscape while watching is an unambiguous "make
  // this big" — worth one more fullscreen attempt (some browsers honour it
  // during the resulting gesture window), and harmless where it's refused.
  // Two listeners because neither fires everywhere: `orientationchange` is
  // deprecated and silent on some Android WebViews, while
  // `screen.orientation`'s own `change` event is the modern replacement
  // but isn't implemented in every in-app browser (notably older iOS
  // Telegram WebViews) — so both are wired and either can trigger it.
  // Also checked once on mount, since a viewer who opens an episode with
  // the phone already lying flat should get the same behaviour as one who
  // rotates into it mid-watch.
  useEffect(() => {
    const onOrientation = () => {
      const landscape = window.innerWidth > window.innerHeight;
      if (landscape && !userExitedFsRef.current && !nativeFullscreenElement()) {
        void enterFullscreen();
      }
    };
    onOrientation();
    window.addEventListener('orientationchange', onOrientation);
    window.addEventListener('resize', onOrientation);
    screen.orientation?.addEventListener?.('change', onOrientation);
    return () => {
      window.removeEventListener('orientationchange', onOrientation);
      window.removeEventListener('resize', onOrientation);
      screen.orientation?.removeEventListener?.('change', onOrientation);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving this screen must never leave the app stuck expanded over
  // Telegram's header, the browser stuck in fullscreen behind whatever
  // screen comes next, or the phone pinned to landscape. Each call is
  // wrapped separately so one failing never skips the others.
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
        (screen.orientation as OrientationLock | undefined)?.unlock?.();
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

  // Bumps the show's real view_count (see increment_show_view_count) once
  // per episode open — same trigger as the watch-log entry above, just a
  // separate call since it writes to a different table. This is what
  // actually drives the Top 10 rail and the view-count badge on cards now,
  // instead of the admin-typed rating number. Fire-and-forget: a failed
  // or slow count bump should never hold up or break playback.
  useEffect(() => {
    supabase.rpc('increment_show_view_count', { p_show_id: show.id }).then(() => {});
  }, [episode.id, show.id]);

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

  // Playback rate and volume live in React state (the controls read them)
  // but belong to the media element — push them across whenever they
  // change, including after a source switch resets the element.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed, playUrl]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = volume;
  }, [volume, playUrl]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const seekTo = (time: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.min(Math.max(time, 0), v.duration || 0);
    v.currentTime = clamped;
    setCurrent(clamped);
  };

  const skip = (delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    seekTo(v.currentTime + delta);
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

  // Unified handler for every "back" affordance in this screen (the
  // top-left arrow, and the error-state buttons). If we're in fullscreen,
  // the first press only backs out of fullscreen — matching what phones
  // already do with their own hardware/gesture back — so a second press
  // is what actually leaves the player. This also guarantees we never
  // tear the video element out of the DOM while it's still the
  // fullscreen element, which is what left the player in a broken state.
  const handleBackPress = () => {
    if (nativeFullscreenElement() || (isInTelegram() && isTelegramFullscreen())) {
      userExitedFsRef.current = true;
      void leaveFullscreen();
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
    hideTimer.current = window.setTimeout(() => setShowControls(false), 3400);
  };

  useEffect(() => {
    revealControls();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  // Anything open on top of the video (episode list, the More sheet), or a
  // paused/scrubbing player, keeps the chrome pinned — hiding controls out
  // from under an open menu is the classic way to strand someone.
  const chromeHidden = !showControls && playing && !episodeListOpen && !moreOpen && !scrubbing;

  // Desktop keyboard shortcuts — the usual video-player set. Suspended
  // while the controls are locked (except the unlock key itself), and
  // skipped whenever a text field has focus so typing never seeks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = e.key.toLowerCase();
      if (locked && key !== 'l') return;
      switch (key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          revealControls();
          break;
        case 'arrowleft':
          skip(-10);
          revealControls();
          break;
        case 'arrowright':
          skip(10);
          revealControls();
          break;
        case 'arrowup':
          setVolume((v) => Math.min(1, v + 0.1));
          revealControls();
          break;
        case 'arrowdown':
          setVolume((v) => Math.max(0, v - 0.1));
          revealControls();
          break;
        case 'm':
          toggleMute();
          revealControls();
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'l':
          setLocked((l) => !l);
          setMoreOpen(false);
          revealControls();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, isFullscreen]);

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
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const episodeTitle =
    show.type === 'movie' ? show.title : `${t.episodeLabel} ${episode.episode_number}: ${episode.title}`;

  return (
    <div
      className="player-root player-immersive"
      data-hidden={chromeHidden}
      onPointerDown={maybeAutoFullscreen}
    >
      <div
        ref={containerRef}
        className="player-stage relative h-full w-full"
        onMouseMove={revealControls}
        onClick={revealControls}
        onContextMenu={(e) => e.preventDefault()}
      >
        <video
          ref={videoRef}
          className={`h-full w-full ${fillScreen ? 'object-cover' : 'object-contain'}`}
          autoPlay
          playsInline
          controlsList="nodownload noremoteplayback noplaybackrate"
          disablePictureInPicture
          disableRemotePlayback
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          onProgress={(e) => {
            // How far ahead of the playhead the network has actually
            // buffered — drawn behind the played range so a stall reads as
            // "still loading" instead of "the app froze".
            const v = e.currentTarget;
            const ranges = v.buffered;
            for (let i = 0; i < ranges.length; i += 1) {
              if (ranges.start(i) <= v.currentTime && ranges.end(i) >= v.currentTime) {
                setBuffered(ranges.end(i));
                break;
              }
            }
          }}
          onTimeUpdate={(e) => {
            const time = e.currentTarget.currentTime;
            if (!scrubbing) setCurrent(time);
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
            e.currentTarget.playbackRate = speed;
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
            paused-state center button and the top/bottom control bars.
            Gone while the screen is locked, which is the entire point of
            the lock: a resting palm can't seek or pause anything. */}
        {!resolving && !accessError && !loadError && !locked && (
          <div className="absolute inset-0 z-[5] flex">
            <div className="h-full w-1/2" onClick={() => handleZoneTap('left')} aria-hidden />
            <div className="h-full w-1/2" onClick={() => handleZoneTap('right')} aria-hidden />
          </div>
        )}

        {/* Brief ±10s flash on double-tap */}
        {seekFlash && (
          <div
            key={seekFlash.key}
            className={`pointer-events-none absolute top-1/2 z-[6] flex -translate-y-1/2 items-center gap-1.5 rounded-xl border border-white/15 bg-black/55 px-5 py-3.5 text-white backdrop-blur-md seek-flash-pop ${
              seekFlash.side === 'left' ? 'left-[10%]' : 'right-[10%]'
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
            <Loader2 className="h-8 w-8 animate-spin text-[#2050D8]" />
          </div>
        )}

        {/* Access denied (not subscribed, etc.) */}
        {!resolving && accessError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center">
            <AlertTriangle className="h-8 w-8 text-[#FFC24D]" />
            <p className="max-w-xs text-sm font-semibold text-white">{accessError}</p>
            <button
              onClick={handleBackPress}
              className="mt-2 rounded-xl border border-white/15 bg-white/10 px-5 py-2 text-sm font-medium text-white transition hover:bg-white/20"
            >
              {t.goBack}
            </button>
          </div>
        )}

        {/* Buffering spinner */}
        {buffering && !loadError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-14 w-14 animate-spin rounded-full border-2 border-white/15 border-t-[#2050D8]" />
          </div>
        )}

        {/* Load error */}
        {loadError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center backdrop-blur-sm">
            <AlertTriangle className="h-9 w-9 text-[#FF6B60]" />
            <p className="text-sm font-semibold text-white">{t.unableToLoadVideo}</p>
            <p className="max-w-xs text-xs text-white/50">{t.videoMissingHint}</p>
            <button
              onClick={handleBackPress}
              className="mt-2 rounded-xl border border-white/15 bg-white/10 px-5 py-2 text-sm font-medium text-white transition hover:bg-white/20"
            >
              {t.goBack}
            </button>
          </div>
        )}

        {/* ── Locked state ────────────────────────────────────────────
            One button, nothing else: every other control and the tap zones
            are gone, so a thumb resting on the phone during a long episode
            can't pause or seek by accident. */}
        {locked && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLocked(false);
              revealControls();
            }}
            className="player-btn absolute right-4 top-1/2 z-30 h-12 w-12 -translate-y-1/2"
            aria-label={t.unlockScreen}
            title={t.screenLockedHint}
          >
            <Lock className="h-5 w-5" />
          </button>
        )}

        {/* ── Top bar: back + title only ──────────────────────────────
            Lock now lives in the "More" sheet on the bottom bar — one
            less icon competing with the title for attention on open. */}
        <div
          className={`player-chrome player-safe-x absolute inset-x-0 top-0 z-10 player-scrim-top pb-10 ${
            isInTelegram() && !isFullscreen
              ? 'pt-14'
              : 'pt-[max(env(safe-area-inset-top,0px),14px)]'
          } ${locked ? 'pointer-events-none opacity-0' : ''}`}
          data-hidden={chromeHidden}
        >
          <div className="flex items-start gap-3">
            {/* The on-screen back pill only renders outside Telegram;
                inside Telegram the native BackButton (registered in
                App.tsx) already handles back navigation, and showing both
                is what used to overlap Telegram's own back pill. */}
            {!isInTelegram() && (
              <button
                onClick={handleBackPress}
                className="player-btn h-10 shrink-0 gap-2 px-4 text-sm font-medium"
                aria-label={t.back}
              >
                <ArrowLeft className="h-4 w-4" /> {t.back}
              </button>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4E86FF]">
                {show.title}
              </p>
              <h2 className="truncate text-base font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] sm:text-xl">
                {episodeTitle}
              </h2>
            </div>
          </div>
        </div>

        {/* Center play/pause when paused */}
        {!playing && !buffering && !loadError && !accessError && !locked && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 z-10 flex items-center justify-center"
            aria-label="Play"
          >
            <div className="player-center-btn flex h-20 w-20 items-center justify-center rounded-full transition hover:scale-105">
              <Play className="ml-1 h-9 w-9 fill-white text-white" />
            </div>
          </button>
        )}

        {/* ── Bottom control bar ─────────────────────────────────────── */}
        <div
          className={`player-chrome player-safe-x absolute inset-x-0 bottom-0 z-10 player-scrim-bottom pb-[max(env(safe-area-inset-bottom,0px),14px)] pt-16 ${
            locked ? 'pointer-events-none opacity-0' : ''
          }`}
          data-hidden={chromeHidden}
        >
          {/* Seek bar — the track thickens and grows a knob while it's
              being dragged, and carries the buffered range behind the
              played one. The transparent range input on top is what makes
              it draggable with a finger and reachable by keyboard. */}
          <div className="mb-2.5 flex items-center gap-3">
            <span className="w-11 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/75">
              {fmtTime(current)}
            </span>
            <div className="seek-wrap group relative flex-1 py-2" data-scrubbing={scrubbing}>
              <div className="seek-track">
                <div className="seek-buffered" style={{ width: `${bufferedPct}%` }} />
                <div className="seek-played" style={{ width: `${progress}%` }} />
                <div className="seek-knob" style={{ left: `${progress}%` }} />
              </div>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={current}
                onChange={(e) => seekTo(Number(e.target.value))}
                onPointerDown={() => setScrubbing(true)}
                onPointerUp={() => setScrubbing(false)}
                onPointerCancel={() => setScrubbing(false)}
                onBlur={() => setScrubbing(false)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label="Seek"
              />
            </div>
            <span className="w-11 shrink-0 font-mono text-[11px] tabular-nums text-white/75">
              {fmtTime(duration)}
            </span>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={togglePlay} className="player-btn h-11 w-11" aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? (
                <Pause className="h-5 w-5 fill-white" />
              ) : (
                <Play className="ml-0.5 h-5 w-5 fill-white" />
              )}
            </button>
            <button onClick={() => skip(-10)} className="player-btn h-10 w-10" aria-label="Back 10s">
              <RotateCcw className="h-[18px] w-[18px]" />
            </button>
            <button onClick={() => skip(10)} className="player-btn h-10 w-10" aria-label="Forward 10s">
              <RotateCw className="h-[18px] w-[18px]" />
            </button>
            <div className="group/vol flex items-center">
              <button
                onClick={toggleMute}
                className="player-btn h-10 w-10"
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                {muted || volume === 0 ? (
                  <VolumeX className="h-[18px] w-[18px]" />
                ) : (
                  <Volume2 className="h-[18px] w-[18px]" />
                )}
              </button>
              {/* Pointer-driven volume is a desktop affordance — phones have
                  hardware keys for it, so this stays out of the way there. */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setVolume(next);
                  const v = videoRef.current;
                  if (v && v.muted && next > 0) {
                    v.muted = false;
                    setMuted(false);
                  }
                }}
                aria-label="Volume"
                className="ml-1 hidden h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/25 opacity-0 transition-all duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100 sm:block"
              />
            </div>

            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {/* Overflow menu: lock, playback speed, fit/fill, and the
                  full episode list — everything a viewer sets once and
                  leaves alone, grouped behind a single icon instead of
                  four competing for space on the bar. The dot keeps the
                  non-default state visible at a glance even while
                  collapsed. */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMoreOpen((o) => !o);
                  }}
                  className={`player-btn relative h-10 w-10 ${
                    speed !== 1 || fillScreen ? 'text-[#4E86FF]' : ''
                  }`}
                  aria-label={t.moreOptions}
                  title={t.moreOptions}
                >
                  <MoreVertical className="h-[18px] w-[18px]" />
                  {(speed !== 1 || fillScreen) && (
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[#2050D8]" />
                  )}
                </button>
                {moreOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-12 right-0 z-30 w-56 overflow-hidden rounded-xl border border-white/[0.12] bg-black/85 p-1.5 backdrop-blur-xl sheet-in"
                  >
                    <button
                      onClick={() => {
                        setMoreOpen(false);
                        setLocked(true);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-white/85 transition hover:bg-white/10"
                    >
                      <Lock className="h-4 w-4" /> {t.lockScreen}
                    </button>

                    <div className="px-3 py-2">
                      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/40">
                        <Gauge className="h-3.5 w-3.5" /> {t.playbackSpeed}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {SPEEDS.map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              setSpeed(s);
                              setMoreOpen(false);
                              revealControls();
                            }}
                            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                              s === speed
                                ? 'bg-[#2050D8]/15 text-[#93B2FF]'
                                : 'bg-white/[0.06] text-white/75 hover:bg-white/10'
                            }`}
                          >
                            {s}× {s === speed && <Check className="h-3 w-3" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setFillScreen((f) => !f);
                        setMoreOpen(false);
                        revealControls();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-white/85 transition hover:bg-white/10"
                    >
                      <Crop className="h-4 w-4" /> {fillScreen ? t.zoomFit : t.zoomFill}
                    </button>

                    {allEpisodes.length > 0 && onSwitchEpisode && (
                      <button
                        onClick={() => {
                          setMoreOpen(false);
                          setEpisodeListOpen(true);
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-semibold text-white/85 transition hover:bg-white/10"
                      >
                        <ListVideo className="h-4 w-4" /> {t.episodesHeading}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {nextEpisode && onSwitchEpisode && (
                <button
                  onClick={() => onSwitchEpisode(nextEpisode)}
                  className="player-btn hidden h-10 gap-1 px-3.5 text-xs font-bold sm:inline-flex"
                  aria-label="Next episode"
                >
                  {t.episodeLabel} {nextEpisode.episode_number} <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                className="player-btn h-11 w-11"
                aria-label={isFullscreen ? t.fullscreenExit : t.fullscreenEnter}
                title={isFullscreen ? t.fullscreenExit : t.fullscreenEnter}
              >
                {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* End-of-episode auto-advance prompt */}
        {autoAdvanceIn !== null && nextEpisode && (
          <div className="absolute bottom-28 right-4 z-20 flex w-64 items-center gap-3 rounded-xl border border-white/[0.12] bg-black/80 p-3 shadow-elevated backdrop-blur-xl sheet-in sm:right-6">
            <img
              src={nextEpisode.thumbnail_url ?? show.poster_url ?? ''}
              alt=""
              className="h-14 w-14 shrink-0 rounded-xl object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#4E86FF]">{t.upNext}</p>
              <p className="truncate text-xs font-semibold text-white">
                {t.episodeLabel} {nextEpisode.episode_number}: {nextEpisode.title}
              </p>
              <p className="text-[11px] text-white/50">{autoAdvanceIn}s</p>
            </div>
            <button
              onClick={() => setAutoAdvanceIn(null)}
              className="player-btn h-7 w-7 shrink-0"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* In-player episode switcher — a bottom sheet so viewers never
            have to leave the player (and lose their place, and their
            fullscreen) just to pick a different episode. Reuses the same
            episode list fetched for "next episode". */}
        {episodeListOpen && (
          <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={() => setEpisodeListOpen(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[72%] overflow-y-auto rounded-t-[18px] border-t border-white/10 bg-app-deep p-4 pb-6 shadow-elevated sheet-in"
            >
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" aria-hidden />
              <div className="mb-3 flex items-center justify-between">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-white">{show.title}</h3>
                  <p className="text-[11px] text-white/45">
                    {allEpisodes.length} {t.episodesHeading}
                  </p>
                </div>
                <button
                  onClick={() => setEpisodeListOpen(false)}
                  className="player-btn h-8 w-8 shrink-0"
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
                          ? 'border-[#2050D8]/45 bg-[#2050D8]/[0.12] shadow-[0_0_22px_rgba(32,80,216,0.18)]'
                          : 'border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08]'
                      }`}
                    >
                      <img
                        src={ep.thumbnail_url ?? show.poster_url ?? ''}
                        alt=""
                        className="h-12 w-20 shrink-0 rounded-xl object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-white">
                          {t.episodeLabel} {ep.episode_number}: {ep.title}
                        </p>
                        {ep.duration && <p className="text-[11px] text-white/40">{ep.duration} min</p>}
                      </div>
                      {isCurrent && <Check className="h-4 w-4 shrink-0 text-[#2050D8]" />}
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
