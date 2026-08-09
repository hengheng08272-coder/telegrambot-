import { Globe } from 'lucide-react';
import type { Lang } from '@/lib/useLang';

interface LanguageSwitcherProps {
  lang: Lang;
  onChange: (l: Lang) => void;
  className?: string;
  /** Skip the default pill chrome (border/bg/padding) when nesting inside another glass container */
  bare?: boolean;
}

export default function LanguageSwitcher({ lang, onChange, className = '', bare = false }: LanguageSwitcherProps) {
  return (
    <div
      className={`flex items-center gap-0.5 ${
        bare ? '' : 'rounded-full border border-white/10 bg-white/[0.04] p-0.5 backdrop-blur-sm'
      } ${className}`}
      role="group"
      aria-label="Language"
    >
      <Globe className="ml-1.5 h-3 w-3 shrink-0 text-white/40" />
      <button
        type="button"
        onClick={() => onChange('km')}
        aria-pressed={lang === 'km'}
        className={`rounded-full px-2 py-1 text-[10px] font-semibold leading-none transition font-khmer ${
          lang === 'km' ? 'bg-[#4CC950] text-black' : 'text-white/60 hover:text-white'
        }`}
      >
        ខ្មែរ
      </button>
      <button
        type="button"
        onClick={() => onChange('en')}
        aria-pressed={lang === 'en'}
        className={`rounded-full px-2 py-1 text-[10px] font-semibold leading-none transition ${
          lang === 'en' ? 'bg-[#4CC950] text-black' : 'text-white/60 hover:text-white'
        }`}
      >
        EN
      </button>
    </div>
  );
}
