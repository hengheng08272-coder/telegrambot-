import { ArrowRight, Gift, Sparkles, X } from 'lucide-react';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface Props {
  variant: 'guest' | 'spin-ready';
  onPrimary: () => void;
  onDismiss: () => void;
}

// Center-of-screen popup banner for the new-member VIP lucky-draw promo.
// - "guest": visitor has no account yet -> CTA opens sign-up.
// - "spin-ready": signed-in user who just became VIP and hasn't used their
//   one-time spin yet -> CTA opens the LuckyDrawModal.
export default function NewMemberPromoBanner({ variant, onPrimary, onDismiss }: Props) {
  const { lang } = useLang();
  const t = appText[lang];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      {/* Rotating gradient ring + soft ambient glow behind the card */}
      <div className="promo-card-glow relative w-full max-w-sm rounded-3xl">
        <div className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-[#E8A94A]/10 blur-3xl" />

        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#171725] to-[#0A0A0F] p-6 text-center shadow-[0_0_70px_rgba(232,169,74,0.2)]">
          {/* Decorative corner sparkles */}
          <Sparkles className="sparkle-twinkle pointer-events-none absolute left-5 top-14 h-3.5 w-3.5 text-[#E8A94A]/50" />
          <Sparkles
            className="sparkle-twinkle pointer-events-none absolute right-8 top-24 h-2.5 w-2.5 text-[#0F8F72]/60"
            style={{ animationDelay: '0.5s' }}
          />
          <Sparkles
            className="sparkle-twinkle pointer-events-none absolute left-10 bottom-24 h-2.5 w-2.5 text-[#E8A94A]/40"
            style={{ animationDelay: '1s' }}
          />

          <button
            onClick={onDismiss}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Gift icon with pulsing glow + gentle float */}
          <div className="relative mx-auto mb-4 flex h-20 w-20 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-[#E8A94A]/35 blur-xl" />
            <div className="absolute inset-0 rounded-full animate-glow-pulse" />
            <div className="gift-float relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#E8A94A] to-[#C98A2E] shadow-lg ring-4 ring-[#E8A94A]/20">
              <Gift className="h-9 w-9 text-[#0A0A0F]" />
            </div>
          </div>

          <div className="mx-auto mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#E8A94A]/30 bg-[#E8A94A]/10 px-3 py-1">
            <Sparkles className="h-3 w-3 text-[#E8A94A]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#E8A94A]">
              {t.promoEyebrow}
            </span>
            <Sparkles className="h-3 w-3 text-[#E8A94A]" />
          </div>

          <h2
            className="mb-2 text-2xl font-black leading-tight text-white"
            style={{ fontFamily: '"Bebas Neue", Battambang, Inter, sans-serif' }}
          >
            {variant === 'guest' ? t.promoGuestTitle : t.promoSpinTitle}
          </h2>
          <p className="mx-auto mb-5 max-w-[15rem] text-sm leading-relaxed text-white/60">
            {variant === 'guest' ? t.promoGuestBody : t.promoSpinBody}
          </p>

          <button
            onClick={onPrimary}
            className="group flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#E8A94A] to-[#C98A2E] py-3.5 text-sm font-bold text-[#0A0A0F] shadow-[0_8px_24px_rgba(232,169,74,0.35)] transition hover:scale-[1.02] hover:shadow-[0_10px_30px_rgba(232,169,74,0.5)] active:scale-[0.98]"
          >
            <span>{variant === 'guest' ? t.promoGuestCta : t.promoSpinCta}</span>
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
