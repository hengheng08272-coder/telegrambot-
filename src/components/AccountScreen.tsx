import { useEffect, useState } from 'react';
import { ArrowLeft, Bookmark, Crown, Gift, ShieldCheck, Sparkles, User } from 'lucide-react';
import { getCurrentTelegramUser } from '@/lib/telegram';
import { getSubscriptionStatus, PRICING_TIERS, type SubscriptionStatus } from '@/lib/subscription';
import { getAvailableBonusSpin, type BonusSpinInfo } from '@/lib/spin';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import LanguageSwitcher from '@/components/LanguageSwitcher';

interface Props {
  onBack: () => void;
  onOpenWatchlist: () => void;
  onOpenSubscription: () => void;
  onOpenSpin: () => void;
}

export default function AccountScreen({ onBack, onOpenWatchlist, onOpenSubscription, onOpenSpin }: Props) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [bonusInfo, setBonusInfo] = useState<BonusSpinInfo | null>(null);
  const telegramUser = getCurrentTelegramUser();
  const { lang, setLang } = useLang();
  const t = appText[lang];

  useEffect(() => {
    getSubscriptionStatus().then(setStatus);
    getAvailableBonusSpin().then(setBonusInfo);
  }, []);

  const tierLabel = status?.tier ? PRICING_TIERS.find((tier) => tier.key === status.tier)?.labelKm ?? status.tier : null;

  const daysLeft = status?.expiresAt
    ? Math.max(0, Math.ceil((new Date(status.expiresAt).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="min-h-screen bg-[#0A0A0D] pb-10 text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <button onClick={onBack} className="text-white/70 transition hover:text-white" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-sm font-bold">គណនីរបស់ខ្ញុំ</h1>
      </div>

      <div className="px-4 py-6">
        {/* Identity — the avatar ring now reflects VIP status directly
            (gold glow for active subscribers, quiet teal for guests)
            instead of always being the same teal ring regardless of
            status, so the premium feel starts here, not just below. */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div
            className="mb-3 flex h-20 w-20 items-center justify-center rounded-full"
            style={
              status?.subscribed
                ? {
                    background: 'linear-gradient(135deg, #F0D9A0, #E3B341 45%, #B2882F)',
                    padding: 2,
                    boxShadow: '0 0 24px rgba(227,179,65,0.35)',
                  }
                : { background: 'rgba(43,92,173,0.35)', padding: 2 }
            }
          >
            <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#12302D] to-[#151A1A]">
              <User className="h-9 w-9 text-white/60" />
            </div>
          </div>
          <p className="text-base font-bold text-white">{telegramUser?.label ?? 'ភ្ញៀវ'}</p>
          {status?.subscribed ? (
            <span
              className="mt-2 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-[#0A0A0D]"
              style={{ background: 'linear-gradient(135deg, #F0D9A0, #E3B341 45%, #B2882F)' }}
            >
              <Crown className="h-3.5 w-3.5" /> សមាជិក VIP
            </span>
          ) : (
            <span className="mt-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/50">
              មិនទាន់ជា VIP
            </span>
          )}
        </div>

        {/* VIP status card — expiry is now the headline number (large,
            top of the card) instead of a small row buried in a list, since
            "when does my VIP run out" is the #1 thing people open this
            screen to check. */}
        {status?.subscribed ? (
          <div className="mb-4 overflow-hidden rounded-2xl border border-[#E3B341]/25 bg-gradient-to-br from-[#E3B341]/10 via-transparent to-[#2B5CAD]/5 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#E3B341]" />
              <p className="text-sm font-bold text-white">VIP កំពុងសកម្ម</p>
              {tierLabel && (
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/60">
                  {tierLabel}
                </span>
              )}
            </div>

            {status.expiresAt && (
              <div className="mb-3 rounded-xl border border-white/10 bg-black/25 p-3 text-center">
                <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">ផុតកំណត់</p>
                <p className="mt-0.5 text-xl font-black text-white">
                  {new Date(status.expiresAt).toLocaleDateString('km-KH', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
                {daysLeft !== null && (
                  <p className="mt-0.5 text-xs font-semibold text-[#2B5CAD]">នៅសល់ {daysLeft} ថ្ងៃ</p>
                )}
              </div>
            )}

            <button
              onClick={onOpenSubscription}
              className="w-full rounded-full border border-[#E3B341]/30 bg-[#E3B341]/10 py-2 text-xs font-bold text-[#E3B341] transition hover:bg-[#E3B341]/20"
            >
              បន្តគម្រោង / ប្តូរគម្រោង
            </button>
          </div>
        ) : (
          <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="mb-3 text-sm text-white/60">ចុះឈ្មោះជា VIP ដើម្បីមើលគ្រប់វគ្គ + ចាប់រង្វាន់ bonus</p>
            <button
              onClick={onOpenSubscription}
              className="w-full rounded-full bg-gradient-to-r from-[#E6231F] to-[#7A0F0D] py-2.5 text-sm font-bold text-white transition"
            >
              ក្លាយជា VIP ឥឡូវនេះ
            </button>
          </div>
        )}

        {/* Bonus spin available — the actual mechanism: buying certain VIP
            plans unlocks one spin for bonus days on top of the plan
            (see BONUS_POOLS), it's a spin the person plays, not days
            added silently, so the copy says exactly that. */}
        {bonusInfo && (
          <button
            onClick={onOpenSpin}
            className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-[#2B5CAD]/30 bg-gradient-to-r from-[#2B5CAD]/10 to-transparent p-4 text-left transition hover:border-[#2B5CAD]/60"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E3B341] to-[#A9782E]">
              <Gift className="h-5 w-5 text-[#0A0A0D]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">មាន Bonus Spin រង់ចាំ!</p>
              <p className="text-xs text-white/50">ការទិញ VIP លើកនេះឲ្យអ្នកនូវការចាប់រង្វាន់ថ្ងៃបន្ថែម ១ដង — ចុចដើម្បីចាប់</p>
            </div>
            <Sparkles className="h-4 w-4 text-[#E3B341]" />
          </button>
        )}

        {/* Quick links — grouped into a single card with an internal
            divider (matches the identity/status card's radius + border
            treatment above) instead of two separate floating blocks, so
            the bottom of the screen reads as one settings list. */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          <button
            onClick={onOpenWatchlist}
            className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.06]"
          >
            <Bookmark className="h-5 w-5 text-white/50" />
            <span className="text-sm font-semibold text-white">បញ្ជីរបស់ខ្ញុំ</span>
          </button>

          <div className="h-px bg-white/10" />

          <div className="flex items-center justify-between p-4">
            <span className="text-sm font-semibold text-white">{t.language}</span>
            <LanguageSwitcher lang={lang} onChange={setLang} />
          </div>
        </div>
      </div>
    </div>
  );
}
