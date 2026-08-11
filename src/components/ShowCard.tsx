import { useRef, useState } from 'react';
import { Eye, Play } from 'lucide-react';
import type { Show } from '@/lib/types';
import { fmtViews } from '@/lib/format';

interface ShowCardProps {
  show: Show;
  onClick: (show: Show) => void;
  /** 1-based rank — when set, renders a big stroked numeral behind the
   *  bottom-left corner of the poster, Top-10-rail style. */
  rank?: number;
  /** Bigger poster + deeper drop shadow — used for the Top 10 rail so it
   *  reads with the same weight as the hero banner above it. */
  large?: boolean;
}

export default function ShowCard({ show, onClick, rank, large }: ShowCardProps) {
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
      className={`group relative shrink-0 text-left ${
        large ? 'w-[168px] sm:w-[210px]' : rank ? 'w-[126px] sm:w-[160px]' : 'w-[100px] sm:w-[124px]'
      } ${rank ? 'pl-8 sm:pl-10' : ''}`}
    >
      {rank && (
        <span
          aria-hidden
          className="pointer-events-none absolute -left-3 top-1/2 z-0 -translate-y-1/2 select-none sm:-left-4"
          style={{
            fontSize: 'clamp(210px, 52vw, 300px)',
            fontWeight: 900,
            lineHeight: 1,
            color: 'rgba(20,10,8,0.55)',
            WebkitTextStroke: '2px rgba(255,201,74,0.75)',
            fontFamily: '"Bebas Neue", Battambang, Inter, sans-serif',
            filter:
              'drop-shadow(0 2px 0 rgba(255,201,74,0.35)) drop-shadow(0 14px 22px rgba(0,0,0,0.9)) drop-shadow(0 0 18px rgba(255,201,74,0.2))',
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
        <div
          className={`aspect-[2/3] overflow-hidden rounded-lg bg-[#241413] ring-1 ring-white/5 transition duration-300 ease-out group-hover:z-20 group-hover:-translate-y-2 group-hover:scale-[1.04] group-hover:ring-[#E31E24]/40 ${
            large
              ? 'shadow-[0_18px_46px_rgba(0,0,0,0.7)] group-hover:shadow-[0_28px_60px_rgba(0,0,0,0.8)]'
              : 'shadow-[0_6px_18px_rgba(0,0,0,0.5)] group-hover:shadow-[0_20px_44px_rgba(0,0,0,0.7)]'
          }`}
        >
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
          {/* Bottom gradient — taller for ranked cards since it also has
              to carry the title text now sitting on the poster itself. */}
          <div
            className="absolute inset-0"
            style={{
              background: rank
                ? 'linear-gradient(180deg, rgba(10,6,5,0) 35%, rgba(10,6,5,0.95) 100%)'
                : 'linear-gradient(180deg, rgba(10,6,5,0) 50%, rgba(10,6,5,0.9) 100%)',
            }}
          />
          {/* Title — overlaid directly on the poster for ranked (Top 10)
              cards so the row reads as pure artwork instead of poster +
              caption; other rows keep the plain caption below the card.
              Single-line with an ellipsis when it's too long to fit, gold
              by default (not just on hover) to match the numeral behind
              it. */}
          {rank && (
            <div className="absolute inset-x-0 bottom-0 z-[1] p-2.5">
              <h3 className="truncate text-[12.5px] font-bold leading-tight text-[#FFC94A] drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] sm:text-[13.5px]">
                {show.title}
              </h3>
            </div>
          )}
          {/* View-count badge — real play counts (see increment_show_view_count),
              not an admin-typed rating, so this is what actually drives
              Top 10 and shows the owner which titles viewers watch most. */}
          <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-[#FFC94A] backdrop-blur-sm">
            <Eye className="h-2.5 w-2.5" />
            {fmtViews(show.view_count)}
          </div>
          {/* Hover play overlay */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 transition duration-300 group-hover:opacity-100">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E31E24] shadow-[0_0_24px_rgba(227,30,36,0.6)]">
              <Play className="h-4 w-4 fill-white text-white" />
            </div>
          </div>
        </div>
      </div>
      {!rank && (
        <div className="mt-2 px-0.5">
          <h3 className={`truncate font-semibold text-white transition group-hover:text-[#E31E24] ${large ? 'text-[15px]' : 'text-[13px]'}`}>
            {show.title}
          </h3>
        </div>
      )}
    </button>
  );
}
