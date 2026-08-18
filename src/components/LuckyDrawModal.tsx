import { useEffect, useRef, useState } from 'react';
import { Gift, Loader2, PartyPopper, Sparkles, X } from 'lucide-react';
import { claimBonusSpin, getAvailableBonusSpin, BONUS_POOLS, type RewardTier, type BonusSpinInfo } from '@/lib/spin';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface Props {
  onClose: () => void;
  onClaimed: (rewardLabel: string, days: number) => void;
}

// Diverse wedge palette pulled from the NINT ANIME brand: blood red,
// near-black, ember orange, chrome silver, with gold reserved for
// whichever slice is the top prize in a given pool.
const WEDGE_PALETTE = [
  '#FF2D46', '#F5C563', '#FF6B7C', '#8F1020', '#C08F33',
  '#7B2D8B', '#1F8A70', '#2C5F8A', '#FF2D46', '#F5C563',
  '#B98430', '#F5C563',
];

export default function LuckyDrawModal({ onClose, onClaimed }: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const [checking, setChecking] = useState(true);
  const [bonusInfo, setBonusInfo] = useState<BonusSpinInfo | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<{ label: string; days: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAvailableBonusSpin().then((info) => {
      setBonusInfo(info);
      setChecking(false);
    });
  }, []);

  const pool: RewardTier[] = bonusInfo ? BONUS_POOLS[bonusInfo.tier] ?? [] : [];
  const segmentDeg = pool.length ? 360 / pool.length : 0;
  const wedgeColors = pool.map((_, i) => WEDGE_PALETTE[i % WEDGE_PALETTE.length]);
  // Wheel scales up and labels shrink a touch as the pool grows (7 slices
  // for the Big Bonus tier vs. 3-6 for the others), so every slice stays
  // legible instead of the text overlapping at the rim.
  const wheelSize = pool.length >= 8 ? 312 : pool.length >= 6 ? 288 : 256;
  const labelRadius = pool.length >= 8 ? 132 : pool.length >= 6 ? 122 : 108;
  const labelFontPx = pool.length >= 8 ? 9 : pool.length >= 6 ? 10 : 11;

  const spin = async () => {
    if (spinning || result || checking || !bonusInfo) return;
    setError(null);
    setSpinning(true);

    const { data, error: err } = await claimBonusSpin(bonusInfo);

    if (err || !data) {
      setSpinning(false);
      setError(err === 'already_used' ? t.spinAlreadyUsed : t.spinError);
      return;
    }

    const tierIndex = pool.findIndex((tier) => tier.label === data.reward_label);
    const idx = tierIndex >= 0 ? tierIndex : 0;
    const segmentCenter = idx * segmentDeg + segmentDeg / 2;
    const extraSpins = 6; // full turns for a satisfying spin
    const target = extraSpins * 360 + (360 - segmentCenter);

    setRotation(target);

    window.setTimeout(() => {
      setSpinning(false);
      setResult({ label: data.reward_label, days: data.reward_days });
      onClaimed(data.reward_label, data.reward_days);
    }, 4200);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={result ? onClose : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="promo-card-glow relative w-full max-w-sm rounded-3xl"
      >
        <div className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-[#F5C563]/10 blur-3xl" />

        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#171725] to-[#07080C] p-6 text-center shadow-[0_0_70px_rgba(245,197,99,0.2)]">
          <Sparkles className="sparkle-twinkle pointer-events-none absolute left-5 top-5 h-3.5 w-3.5 text-[#F5C563]/50" />
          <Sparkles
            className="sparkle-twinkle pointer-events-none absolute right-14 top-8 h-2.5 w-2.5 text-[#FF2D46]/60"
            style={{ animationDelay: '0.5s' }}
          />

          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="mb-1 flex items-center justify-center gap-1.5 text-[#F5C563]">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">VIP BONUS SPIN</span>
            <Sparkles className="h-4 w-4" />
          </div>
          <h2
            className="mb-4 text-2xl font-black text-white"
            style={{ fontFamily: '"Anton", Battambang, Inter, sans-serif' }}
          >
            {t.spinTitle}
          </h2>

          {checking ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/40" />
            </div>
          ) : !bonusInfo ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 px-4 text-center">
              <Gift className="h-10 w-10 text-white/20" />
              <p className="text-sm text-white/50">
                គ្មានរង្វាន់រង់ចាំទេឥឡូវនេះ — ទិញ VIP ដើម្បីទទួល bonus spin ថ្ងៃបន្ថែម!
              </p>
            </div>
          ) : (
            <div className="relative mx-auto mb-5" style={{ height: wheelSize, width: wheelSize }}>
              <div className="pointer-events-none absolute inset-[-14px] rounded-full bg-[#F5C563]/15 blur-2xl" />

              <div className="absolute left-1/2 top-[-8px] z-10 h-7 w-7 -translate-x-1/2 rotate-180 drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
                <div
                  className="h-0 w-0 border-x-[11px] border-t-[18px] border-x-transparent border-t-[#F5C563]"
                  style={{ transform: 'rotate(180deg)' }}
                />
              </div>

              <div
                ref={wheelRef}
                className="relative h-full w-full rounded-full border-4 border-[#F5C563]/60 shadow-[0_0_50px_rgba(245,197,99,0.25),0_0_40px_rgba(0,0,0,0.5)]"
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transition: spinning ? 'transform 4.2s cubic-bezier(0.17,0.67,0.16,0.99)' : 'none',
                  background: `conic-gradient(${pool.map(
                    (_, i) => `${wedgeColors[i]} ${i * segmentDeg}deg ${(i + 1) * segmentDeg}deg`,
                  ).join(', ')})`,
                }}
              >
                {/* Thin dividers between slices so dense pools (6-7 wedges) still read as distinct */}
                {pool.map((tier, i) => (
                  <div
                    key={`div-${tier.key}`}
                    className="absolute left-1/2 top-1/2 h-1/2 w-px origin-top bg-black/25"
                    style={{ transform: `rotate(${i * segmentDeg}deg)` }}
                  />
                ))}

                {pool.map((tier, i) => {
                  const angle = i * segmentDeg + segmentDeg / 2;
                  return (
                    <div
                      key={tier.key}
                      className="absolute left-1/2 top-1/2 h-0 w-0 origin-top-left"
                      style={{ transform: `rotate(${angle}deg)` }}
                    >
                      <span
                        className="absolute -translate-x-1/2 whitespace-nowrap font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                        style={{ top: `-${labelRadius}px`, fontSize: `${labelFontPx}px` }}
                      >
                        {tier.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-[#07080C] bg-gradient-to-br from-[#F5C563] to-[#B98430] shadow-lg">
                <Gift className={`h-6 w-6 text-[#07080C] ${spinning ? '' : 'gift-float'}`} />
              </div>
            </div>
          )}

          {error && (
            <p className="mb-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
          )}

          {result ? (
            <div className="win-pop-in space-y-3">
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-[#F5C563]/30 bg-[#F5C563]/10 px-4 py-1.5">
                <PartyPopper className="h-4 w-4 text-[#F5C563]" />
                <p className="text-base font-bold text-[#F5C563]">
                  {t.spinWonPrefix} {result.label} {t.spinWonSuffixVip}
                </p>
              </div>
              <button
                onClick={onClose}
                className="btn-primary w-full rounded-full py-3.5 text-sm font-bold shadow-[0_8px_24px_rgba(255,45,70,0.35)] transition hover:scale-[1.02] hover:shadow-[0_10px_30px_rgba(255,45,70,0.5)] active:scale-[0.98]"
              >
                {t.spinCollect}
              </button>
            </div>
          ) : !checking && !bonusInfo ? (
            <button
              onClick={onClose}
              className="w-full rounded-full border border-white/10 bg-white/5 py-3.5 text-sm font-bold text-white transition hover:bg-white/10"
            >
              បិទ
            </button>
          ) : (
            <button
              onClick={spin}
              disabled={spinning || checking || !!error}
              className="w-full rounded-full bg-gradient-to-r from-[#F5C563] to-[#B98430] py-3.5 text-sm font-bold text-[#07080C] shadow-[0_8px_24px_rgba(245,197,99,0.35)] transition hover:scale-[1.02] hover:shadow-[0_10px_30px_rgba(245,197,99,0.5)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              {spinning ? t.spinSpinning : t.spinButton}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
