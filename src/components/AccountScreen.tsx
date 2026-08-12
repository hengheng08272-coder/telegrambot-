import { useEffect, useState } from 'react';
import { ArrowLeft, Bookmark, Crown, Gift, ShieldCheck, Sparkles, User } from 'lucide-react';
import { getCurrentTelegramUser } from '@/lib/telegram';
import { getSubscriptionStatus, PRICING_TIERS, type SubscriptionStatus } from '@/lib/subscription';
import { getAvailableBonusSpin, type BonusSpinInfo } from '@/lib/spin';

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

  useEffect(() => {
    getSubscriptionStatus().then(setStatus);
    getAvailableBonusSpin().then(setBonusInfo);
  }, []);

  const tierLabel = status?.tier ? PRICING_TIERS.find((t) => t.key === status.tier)?.labelKm ?? status.tier : null;

  return (
    <div className="min-h-screen bg-[#0A0605] pb-10 text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <button onClick={onBack} className="text-white/70 transition hover:text-white" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-sm font-bold">គណនីរបស់ខ្ញុំ</h1>
      </div>

      <div className="px-4 py-6">
        {/* Identity */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#FFC94A]/40 bg-gradient-to-br from-[#3A1414] to-[#241413]">
            <User className="h-9 w-9 text-white/60" />
          </div>
          <p className="text-base font-bold text-white">
            {telegramUser?.label ?? 'ភ្ញៀវ'}
          </p>
          {status?.subscribed ? (
            <span className="mt-2 flex items-center gap-1.5 rounded-full bg-[#FFC94A]/15 px-3 py-1 text-xs font-bold text-[#FFC94A]">
              <Crown className="h-3.5 w-3.5" /> សមាជិក VIP
            </span>
          ) : (
            <span className="mt-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/50">
              មិនទាន់ជា VIP
            </span>
          )}
        </div>

        {/* VIP status card */}
        {status?.subscribed ? (
          <div className="mb-4 rounded-2xl border border-[#FFC94A]/25 bg-gradient-to-br from-[#FFC94A]/10 to-transparent p-4">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#FFC94A]" />
              <p className="text-sm font-bold text-white">VIP កំពុងសកម្ម</p>
            </div>
            <div className="space-y-1 text-xs text-white/60">
              {tierLabel && (
                <div className="flex justify-between">
                  <span>គម្រោង</span>
                  <span className="font-semibold text-white">{tierLabel}</span>
                </div>
              )}
              {status.expiresAt && (
                <div className="flex justify-between">
                  <span>ផុតកំណត់</span>
                  <span className="font-semibold text-white">
                    {new Date(status.expiresAt).toLocaleDateString('km-KH')}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={onOpenSubscription}
              className="mt-3 w-full rounded-full border border-[#FFC94A]/30 bg-[#FFC94A]/10 py-2 text-xs font-bold text-[#FFC94A] transition hover:bg-[#FFC94A]/20"
            >
              បន្តគម្រោង / ប្តូរគម្រោង
            </button>
          </div>
        ) : (
          <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="mb-3 text-sm text-white/60">ចុះឈ្មោះជា VIP ដើម្បីមើលគ្រប់វគ្គ + ចាប់រង្វាន់ bonus</p>
            <button
              onClick={onOpenSubscription}
              className="w-full rounded-full bg-gradient-to-r from-[#E31E24] to-[#8C0F12] py-2.5 text-sm font-bold text-white transition"
            >
              ក្លាយជា VIP ឥឡូវនេះ
            </button>
          </div>
        )}

        {/* Bonus spin available */}
        {bonusInfo && (
          <button
            onClick={onOpenSpin}
            className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-[#E31E24]/30 bg-gradient-to-r from-[#E31E24]/10 to-transparent p-4 text-left transition hover:border-[#E31E24]/60"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FFC94A] to-[#B8862E]">
              <Gift className="h-5 w-5 text-[#0A0605]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">មាន Bonus Spin រង់ចាំ!</p>
              <p className="text-xs text-white/50">ចុចដើម្បីចាប់រង្វាន់ថ្ងៃបន្ថែម</p>
            </div>
            <Sparkles className="h-4 w-4 text-[#FFC94A]" />
          </button>
        )}

        {/* Quick links */}
        <button
          onClick={onOpenWatchlist}
          className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:bg-white/[0.06]"
        >
          <Bookmark className="h-5 w-5 text-white/50" />
          <span className="text-sm font-semibold text-white">បញ្ជីរបស់ខ្ញុំ</span>
        </button>
      </div>
    </div>
  );
}
