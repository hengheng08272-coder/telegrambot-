import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import {
  ArrowLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  SkipBack,
  SkipForward,
  Loader2,
} from 'lucide-react';
import type { Episode, ShowWithGenres } from '@/lib/types';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface VideoPlayerScreenProps {
  episode: Episode;
  show: ShowWithGenres;
  onBack: () => void;
}

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
}: VideoPlayerScreenProps) {
  const { lang } = useLang();
  const t = appText[lang];
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const hlsRef = useRef<Hls | null>(null);

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

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
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
          onClick={togglePlay}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onError={() => setLoadError(true)}
        />

        {/* Resolving playback URL */}
        {resolving && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black">
            <Loader2 className="h-8 w-8 animate-spin text-[#0F8F72]" />
          </div>
        )}

        {/* Access denied (not subscribed, etc.) */}
        {!resolving && accessError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black text-center">
            <p className="max-w-xs text-sm font-semibold text-white">{accessError}</p>
            <button
              onClick={onBack}
              className="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
            >
              {t.goBack}
            </button>
          </div>
        )}

        {/* Buffering spinner */}
        {buffering && !loadError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-[#0F8F72]" />
          </div>
        )}

        {/* Load error */}
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="h-8 w-8 text-[#0F8F72]" />
            <p className="text-sm font-semibold text-white">{t.unableToLoadVideo}</p>
            <p className="max-w-xs text-xs text-white/50">
              {t.videoMissingHint}
            </p>
            <button
              onClick={onBack}
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
            onClick={onBack}
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
          <p className="text-xs font-medium uppercase tracking-wider text-[#0F8F72]">
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
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#0F8F72]/90 shadow-[0_0_40px_rgba(15,143,114,0.5)] transition hover:scale-110">
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
                  className="h-full rounded-full bg-[#0F8F72] transition-all"
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
              className="text-white transition hover:text-[#0F8F72]"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="h-6 w-6 fill-white" /> : <Play className="h-6 w-6 fill-white" />}
            </button>
            <button
              onClick={() => skip(-10)}
              className="text-white/80 transition hover:text-[#0F8F72]"
              aria-label="Back 10s"
            >
              <SkipBack className="h-5 w-5" />
            </button>
            <button
              onClick={() => skip(10)}
              className="text-white/80 transition hover:text-[#0F8F72]"
              aria-label="Forward 10s"
            >
              <SkipForward className="h-5 w-5" />
            </button>
            <button
              onClick={toggleMute}
              className="text-white/80 transition hover:text-[#0F8F72]"
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <div className="ml-auto flex items-center gap-4">
              <button
                onClick={toggleFullscreen}
                className="text-white/80 transition hover:text-[#0F8F72]"
                aria-label="Fullscreen"
              >
                <Maximize className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
