import { useRef, useState } from 'react';
import { Star, Play } from 'lucide-react';
import type { Show } from '@/lib/types';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface ShowCardProps {
  show: Show;
  onClick: (show: Show) => void;
  /** 1-based rank — when set, renders a big stroked numeral behind the
   *  bottom-left corner of the poster, Top-10-rail style. */
  rank?: number;
}

export default function ShowCard({ show, onClick, rank }: ShowCardProps) {
  const { lang } = useLang();
  const t = appText[lang];
  const [loaded, setLoaded] = useState(false);
  const tiltRef = useRef<HTMLDivElement>(null);

  // Subtle pointer-driven 3D tilt — works for mouse hover and for a
  // finger resting/dragging on the card (Pointer Events unify both).
  // Mutates the DOM node directly instead of going through React state so
  // it stays smooth at 60fps even while scrolling a rail full of these.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = tiltRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${(-py * 12).toFixed(2)}deg) rotateY(${(px * 12).toFixed(2)}deg)`;
  };
  const resetTilt = () => {
    const el = tiltRef.current;
    if (el) el.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg)';
  };

  return (
    <button
      onClick={() => onClick(show)}
      className={`group relative w-[124px] shrink-0 text-left sm:w-[150px] ${rank ? 'pl-5 sm:pl-7' : ''}`}
    >
      {rank && (
        <span
          aria-hidden
          className="pointer-events-none absolute -left-1 bottom-1 z-0 select-none text-transparent sm:-left-2"
          style={{
            fontSize: 'clamp(52px, 16vw, 84px)',
            fontWeight: 900,
            lineHeight: 1,
            WebkitTextStroke: '2px rgba(255,201,74,0.85)',
            fontFamily: '"Bebas Neue", Battambang, Inter, sans-serif',
            filter: 'drop-shadow(0 6px 14px rgba(0,0,0,0.85))',
          }}
        >
          {rank}
        </span>
      )}
      <div
        ref={tiltRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={resetTilt}
        onPointerUp={resetTilt}
        onPointerCancel={resetTilt}
        className="relative z-10"
        style={{ transition: 'transform 0.35s ease-out', transform: 'perspective(700px) rotateX(0deg) rotateY(0deg)' }}
      >
        <div className="aspect-[2/3] overflow-hidden rounded-lg bg-[#241413] shadow-[0_6px_18px_rgba(0,0,0,0.5)] ring-1 ring-white/5 transition duration-300 ease-out group-hover:z-20 group-hover:-translate-y-2 group-hover:scale-[1.04] group-hover:shadow-[0_20px_44px_rgba(0,0,0,0.7)] group-hover:ring-[#E31E24]/40">
          {!loaded && <div className="absolute inset-0 animate-pulse bg-[#241413]" />}
          <img
            src={show.poster_url ?? ''}
            alt={show.title}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-105 ${
              loaded ? 'img-fade loaded' : 'img-fade'
            }`}
          />
          {/* Bottom gradient */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(10,6,5,0) 50%, rgba(10,6,5,0.9) 100%)',
            }}
          />
          {/* Rating badge */}
          <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-[#FFC94A] backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-[#FFC94A] text-[#FFC94A]" />
            {Number(show.rating).toFixed(1)}
          </div>
          {/* Free-to-watch ribbon — top-left, only for titles that don't need VIP */}
          {show.is_free && (
            <div className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-[#FFC94A]/95 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black">
              🔓 {t.freeBadge}
            </div>
          )}
          {/* Hover play overlay */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition duration-300 group-hover:opacity-100">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E31E24] shadow-[0_0_24px_rgba(227,30,36,0.6)]">
              <Play className="h-4 w-4 fill-white text-white" />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <h3 className="truncate text-[13px] font-semibold text-white transition group-hover:text-[#E31E24]">
          {show.title}
        </h3>
        <p className="mt-0.5 truncate text-[11px] text-white/50">
          {show.type === 'movie' ? '🎬' : '📺'} {show.release_year ?? '—'} · {show.type === 'movie' ? t.movie : t.series}
          {show.genres?.[0] && <span className="text-white/30"> · {show.genres[0].name}</span>}
        </p>
      </div>
    </button>
  );
}
