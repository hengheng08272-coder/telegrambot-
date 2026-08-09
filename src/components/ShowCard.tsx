import { useState } from 'react';
import { Star, Play } from 'lucide-react';
import type { Show } from '@/lib/types';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface ShowCardProps {
  show: Show;
  onClick: (show: Show) => void;
}

export default function ShowCard({ show, onClick }: ShowCardProps) {
  const { lang } = useLang();
  const t = appText[lang];
  const [loaded, setLoaded] = useState(false);

  return (
    <button
      onClick={() => onClick(show)}
      className="group relative w-[160px] shrink-0 text-left sm:w-[180px]"
    >
      <div className="relative z-10 aspect-[2/3] overflow-hidden rounded-xl bg-[#1E1E2A] shadow-[0_8px_24px_rgba(0,0,0,0.5)] ring-1 ring-white/5 transition duration-300 ease-out group-hover:z-20 group-hover:-translate-y-2 group-hover:scale-[1.04] group-hover:shadow-[0_20px_44px_rgba(0,0,0,0.7)] group-hover:ring-[#0F8F72]/40">
        {!loaded && <div className="absolute inset-0 animate-pulse bg-[#1E1E2A]" />}
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
              'linear-gradient(180deg, rgba(10,10,15,0) 50%, rgba(10,10,15,0.9) 100%)',
          }}
        />
        {/* Rating badge */}
        <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-[#E8A94A] backdrop-blur-sm">
          <Star className="h-3 w-3 fill-[#E8A94A] text-[#E8A94A]" />
          {Number(show.rating).toFixed(1)}
        </div>
        {/* Free-to-watch ribbon — top-left, only for titles that don't need VIP */}
        {show.is_free && (
          <div className="absolute left-2 top-2 flex items-center gap-0.5 rounded-md bg-[#22C55E]/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black">
            🔓 {t.freeBadge}
          </div>
        )}
        {/* Hover play overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition duration-300 group-hover:opacity-100">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0F8F72] shadow-[0_0_24px_rgba(15,143,114,0.6)]">
            <Play className="h-5 w-5 fill-white text-white" />
          </div>
        </div>
      </div>
      <div className="mt-2.5 px-0.5">
        <h3 className="truncate text-sm font-semibold text-white transition group-hover:text-[#0F8F72]">
          {show.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-white/50">
          {show.type === 'movie' ? '🎬' : '📺'} {show.release_year ?? '—'} · {show.type === 'movie' ? t.movie : t.series}
          {show.genres?.[0] && <span className="text-white/30"> · {show.genres[0].name}</span>}
        </p>
      </div>
    </button>
  );
}
