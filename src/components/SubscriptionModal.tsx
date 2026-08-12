import { useEffect, useRef, useState } from 'react';
import { Check, Clock, Crown, Gift, Loader2, PartyPopper, Send, Sparkles, Star, Upload, X, Zap } from 'lucide-react';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import { BONUS_POOLS } from '@/lib/spin';
import {
  PRICING_TIERS,
  getEffectivePricingTiers,
  type PricingTier,
  submitPayment,
  getPendingSubmission,
  getQrCodes,
  checkSubmissionStatus,
  autoApprovePayment,
  type PaymentSubmission,
} from '@/lib/subscription';

interface Props {
  onClose: () => void;
  onSubmitted: () => void;
  onApproved: () => void;
  onGoSpin: () => void;
}

type Step = 'pick' | 'pay' | 'sent';
const AUTO_APPROVE_SECONDS = 30;

// Per-tier presentation: icon + a short Khmer pitch. Bonus-day range is
// computed live from lib/spin.ts BONUS_POOLS below (never hand-typed),
// so the promise on screen can never drift from what the spin wheel
// actually pays out.
const TIER_PRESENTATION: Record<string, { icon: typeof Zap }> = {
  '1m': { icon: Zap },
  '2m': { icon: Gift },
  '6m': { icon: Star },
  '12m': { icon: Crown },
};

function bonusRangeLabel(tierKey: string): string | null {
  const pool = BONUS_POOLS[tierKey];
  if (!pool || pool.length === 0) return null;
  const days = pool.map((t) => t.days);
  const min = Math.min(...days);
  const max = Math.max(...days);
  return min === max ? `${min} ថ្ងៃ` : `${min}-${max} ថ្ងៃ`;
}

// Real KHQR images bundled with the app as the day-one default — the
// admin can still override any of these later from Admin Panel -> QR
// Codes (that upload always takes priority over this fallback).
const FALLBACK_QR_IMAGES: Record<string, string> = {
  '1m': '/assets/qr-1m.png',
  '2m': '/assets/qr-1m-bonus.png',
  '6m': '/assets/qr-6m.png',
  '12m': '/assets/qr-12m.png',
};

export default function SubscriptionModal({ onClose, onSubmitted, onApproved, onGoSpin }: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const [step, setStep] = useState<Step>('pick');
  const [tierKey, setTierKey] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PaymentSubmission | null>(null);
  const [checkingPending, setCheckingPending] = useState(true);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<PricingTier[]>(PRICING_TIERS);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_APPROVE_SECONDS);
  const [decision, setDecision] = useState<'waiting' | 'approved' | 'rejected'>('waiting');
  const notifiedApprovedRef = useRef(false);

  useEffect(() => {
    getPendingSubmission().then((p) => {
      setPending(p);
      setCheckingPending(false);
      if (p) setStep('sent');
    });
    getQrCodes().then(setQrImages);
    getEffectivePricingTiers().then(setTiers);
  }, []);

  useEffect(() => {
    if (step !== 'sent' || !pending || decision !== 'waiting') return;

    const pollInterval = window.setInterval(async () => {
      const status = await checkSubmissionStatus(pending.id);
      if (status === 'approved') setDecision('approved');
      else if (status === 'rejected') setDecision('rejected');
    }, 3000);

    const countdown = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

    return () => {
      window.clearInterval(pollInterval);
      window.clearInterval(countdown);
    };
  }, [step, pending, decision]);

  useEffect(() => {
    if (secondsLeft > 0 || decision !== 'waiting' || !pending) return;
    autoApprovePayment(pending.id).then(async () => {
      const status = await checkSubmissionStatus(pending.id);
      setDecision(status === 'rejected' ? 'rejected' : 'approved');
    });
  }, [secondsLeft, decision, pending]);

  useEffect(() => {
    if (decision === 'approved' && !notifiedApprovedRef.current) {
      notifiedApprovedRef.current = true;
      onApproved();
    }
  }, [decision, onApproved]);

  const tier = tiers.find((tr) => tr.key === tierKey) ?? null;

  const handlePickTier = (key: string) => {
    setTierKey(key);
    setStep('pay');
  };

  const handleFile = (f: File | null) => {
    setFile(f);
    setError('');
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const handleSubmit = async () => {
    if (!tier || !file) {
      setError(t.subMissingProof);
      return;
    }
    setSubmitting(true);
    setError('');
    const { error: err } = await submitPayment({ tierKey: tier.key, amount: tier.price, screenshot: file });
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    onSubmitted();
    setSecondsLeft(AUTO_APPROVE_SECONDS);
    setDecision('waiting');
    getPendingSubmission().then((p) => p && setPending(p));
    setStep('sent');
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="hero-card-enter relative w-full max-w-md overflow-hidden rounded-t-3xl border border-white/10 bg-[#120A0A] p-5 sm:rounded-3xl max-h-[90vh] overflow-y-auto"
      >
        {/* Brand-consistent ember glow, echoing the home screen's hero backdrop */}
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 80% 45% at 50% -8%, rgba(255,201,74,0.16) 0%, rgba(10,6,5,0) 60%), radial-gradient(ellipse 65% 45% at 100% 100%, rgba(227,30,36,0.14) 0%, rgba(10,6,5,0) 58%)',
          }}
        />

        <button
          onClick={onClose}
          className="absolute right-5 top-5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-5 flex flex-col items-center text-center">
          <div className="relative mb-3">
            <div className="pointer-events-none absolute inset-[-6px] rounded-2xl bg-[#FFC94A]/15 blur-xl" />
            <img src="/assets/logo.png" alt="NINT ANIME" className="relative h-16 w-16 rounded-2xl ring-1 ring-[#FFC94A]/30" />
          </div>
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-[#E31E24]/25 bg-[#E31E24]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-[#FF6A57]">
            <Crown className="h-3 w-3" />
            {t.subTicketEyebrow}
          </div>
          <h2
            className="text-xl font-black text-white"
            style={{ fontFamily: '"Bebas Neue", Battambang, Inter, sans-serif', letterSpacing: '0.02em' }}
          >
            {t.subGoPremium}
          </h2>
          <p className="mt-0.5 text-xs text-white/45">{t.subTagline}</p>
        </div>

        {checkingPending ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-white/40" />
          </div>
        ) : step === 'pick' ? (
          <div className="space-y-3">
            {tiers.map((tr) => {
              const presentation = TIER_PRESENTATION[tr.key];
              const Icon = presentation?.icon ?? Zap;
              const bonusLabel = tr.bonusEnabled ? bonusRangeLabel(tr.key) : null;
              const isHighlight = tr.badge === 'best' || tr.badge === 'popular';
              return (
                <button
                  key={tr.key}
                  onClick={() => handlePickTier(tr.key)}
                  className={`relative w-full overflow-hidden rounded-2xl border px-4 py-4 text-left transition active:scale-[0.98] ${
                    tr.badge === 'best'
                      ? 'border-[#FFC94A]/45 bg-gradient-to-br from-[#FFC94A]/12 via-transparent to-transparent hover:border-[#FFC94A]/75'
                      : tr.badge === 'popular'
                        ? 'border-[#E31E24]/40 bg-gradient-to-br from-[#E31E24]/12 via-transparent to-transparent hover:border-[#E31E24]/70'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/25'
                  }`}
                >
                  {isHighlight && (
                    <div
                      className="pointer-events-none absolute -inset-8 opacity-60"
                      style={{
                        background:
                          tr.badge === 'best'
                            ? 'radial-gradient(ellipse 60% 80% at 100% 0%, rgba(255,201,74,0.16) 0%, rgba(10,6,5,0) 60%)'
                            : 'radial-gradient(ellipse 60% 80% at 100% 0%, rgba(227,30,36,0.16) 0%, rgba(10,6,5,0) 60%)',
                      }}
                    />
                  )}

                  <div className="relative flex items-center gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                        isHighlight
                          ? tr.badge === 'best'
                            ? 'bg-gradient-to-br from-[#FFC94A] to-[#B8862E] shadow-[0_4px_16px_rgba(255,201,74,0.3)]'
                            : 'bg-gradient-to-br from-[#E31E24] to-[#8C0F12] shadow-[0_4px_16px_rgba(227,30,36,0.3)]'
                          : 'bg-white/10'
                      }`}
                    >
                      <Icon className={`h-5 w-5 ${isHighlight ? 'text-[#0A0605]' : 'text-white/70'}`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{lang === 'km' ? tr.labelKm : tr.labelEn}</span>
                        {tr.badge === 'popular' && (
                          <span className="rounded-full bg-[#E31E24]/20 px-2 py-0.5 text-[10px] font-bold text-[#FF6A57]">
                            {t.subPopular}
                          </span>
                        )}
                        {tr.badge === 'best' && (
                          <span className="rounded-full bg-[#FFC94A]/20 px-2 py-0.5 text-[10px] font-bold text-[#FFC94A]">
                            {t.subBestValue}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-white/45">{tr.pitchKm}</p>
                    </div>

                    <span className="shrink-0 text-lg font-extrabold text-white">${tr.price}</span>
                  </div>

                  {bonusLabel && (
                    <div className="relative mt-3 flex items-center gap-1.5 rounded-lg border border-[#FFC94A]/15 bg-black/25 px-2.5 py-1.5">
                      <Sparkles className="gift-float h-3.5 w-3.5 shrink-0 text-[#FFC94A]" />
                      <span className="text-[11px] font-semibold text-[#FFC94A]">
                        ចាប់រង្វាន់ថ្ងៃបន្ថែម {bonusLabel}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ) : step === 'pay' && tier ? (
          <div className="space-y-4">
            <button onClick={() => setStep('pick')} className="text-xs text-white/50 hover:text-white">
              ← {t.subBackBtn}
            </button>

            <div className="relative overflow-hidden rounded-2xl border border-[#FFC94A]/20 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-4 text-center">
              <div
                className="pointer-events-none absolute -inset-6 -z-10 opacity-70"
                style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 0%, rgba(255,201,74,0.12) 0%, rgba(10,6,5,0) 65%)' }}
              />
              <p className="mb-1 text-xs text-white/50">{t.subTotalDue}</p>
              <p className="mb-3 text-2xl font-extrabold text-white">
                ${tier.price} <span className="text-sm font-medium text-white/40">/ {lang === 'km' ? tier.labelKm : tier.labelEn}</span>
              </p>
              {qrImages[tier.key] || FALLBACK_QR_IMAGES[tier.key] ? (
                <img
                  src={qrImages[tier.key] || FALLBACK_QR_IMAGES[tier.key]}
                  alt="KHQR"
                  className="mx-auto w-full max-w-[260px] rounded-xl border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
                />
              ) : (
                <p className="rounded-xl border border-[#FFC94A]/25 bg-[#FFC94A]/5 p-4 text-xs text-[#FFC94A]">
                  QR មិនទាន់ត្រៀមសម្រាប់ជម្រើសនេះ — សូមទាក់ទង admin ដោយផ្ទាល់ក្នុង group។
                </p>
              )}
              <p className="mt-2 text-xs text-white/40">{t.subScanHint}</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-white/70">{t.subUploadReceiptTitle}</p>
              <p className="mb-3 text-xs text-white/40">{t.subUploadReceiptDesc}</p>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] py-6 transition hover:border-[#E31E24]/40">
                <Upload className="h-5 w-5 text-white/40" />
                <span className="text-xs text-white/50">{file ? file.name : t.subChooseScreenshot}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {preview && (
                <img src={preview} alt="preview" className="mt-3 max-h-48 w-full rounded-xl object-contain" />
              )}
            </div>

            {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={submitting || !file}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#E31E24] to-[#8C0F12] py-3.5 text-sm font-bold text-white shadow-[0_10px_30px_rgba(227,30,36,0.35)] transition disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? t.subSending : t.subConfirmPaid}
            </button>
          </div>
        ) : decision === 'approved' ? (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#22C55E]/10">
              <PartyPopper className="h-7 w-7 text-[#22C55E]" />
            </div>
            <div>
              <p className="text-base font-bold text-white">VIP ត្រូវបានដោះសោហើយ! 🎉</p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/55">
                ឥឡូវអ្នកអាចមើលរឿងទាំងអស់បានហើយ — កុំភ្លេចចាប់រង្វាន់ bonus ថ្ងៃបន្ថែមផងដែរ!
              </p>
            </div>
            <button
              onClick={onGoSpin}
              className="w-full rounded-full bg-gradient-to-r from-[#FFC94A] to-[#B8862E] py-3 text-sm font-bold text-[#0A0605] transition"
            >
              <Check className="mr-1.5 inline h-4 w-4" />
              ចាប់រង្វាន់ & មើលរឿង
            </button>
          </div>
        ) : decision === 'rejected' ? (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
              <X className="h-7 w-7 text-red-400" />
            </div>
            <div>
              <p className="text-base font-bold text-white">ការទូទាត់មិនត្រូវបានទទួលស្គាល់ទេ</p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/55">
                សូមទាក់ទង admin ក្នុង group ដើម្បីដឹងមូលហេតុ ឬសាកល្បង upload ម្តងទៀត។
              </p>
            </div>
            <button
              onClick={() => {
                setStep('pick');
                setPending(null);
                setDecision('waiting');
              }}
              className="w-full rounded-full border border-white/10 bg-white/5 py-3 text-sm font-bold text-white transition hover:bg-white/10"
            >
              សាកល្បងម្តងទៀត
            </button>
          </div>
        ) : (
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#FFC94A]/10">
              <Clock className="h-7 w-7 text-[#FFC94A]" />
            </div>
            <div>
              <p className="text-base font-bold text-white">{t.subPendingTitle}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/55">{t.subPendingBody}</p>
            </div>
            {pending && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left text-xs text-white/60">
                <div className="flex justify-between py-0.5">
                  <span>{t.subAmountPaid}</span>
                  <span className="font-semibold text-white">${pending.amount}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>{t.subPaymentDate}</span>
                  <span className="font-semibold text-white">
                    {new Date(pending.submitted_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            )}
            <div className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs text-white/40">
              <Clock className="h-3 w-3" />
              {secondsLeft}s
            </div>
            <button
              onClick={onClose}
              className="w-full rounded-full border border-white/10 bg-white/5 py-3 text-sm font-bold text-white transition hover:bg-white/10"
            >
              {t.subCloseBtn}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
