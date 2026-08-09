import { useEffect, useRef, useState } from 'react';
import {
  X,
  Crown,
  CheckCircle2,
  Loader2,
  Sparkles,
  Download,
  ShieldCheck,
  ArrowLeft,
  Ticket,
  ScanLine,
  Copy,
  Check,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

const LOGO_URL = '/assets/images/logo-transparent.png';

// ─── Brand tokens — kept in sync with src/styles/theme.ts so this modal
// reads as part of the same product, not a bolted-on design. ───────────
const COLOR = {
  gold: '#E8A94A',
  goldDeep: '#D4821E',
  primary: '#0F8F72',
  primaryDeep: '#0B6E58',
  primaryLight: '#3FD8B0',
  success: '#22C55E',
  error: '#EF4444',
};
const DISPLAY_FONT = '"Bebas Neue", "Battambang", "Inter", system-ui, sans-serif';

type PlanKey = '1m' | '2m' | '6m' | '1y';

const PLANS: {
  key: PlanKey;
  months: number;
  price: number;
  labelKey: 'sub1Month' | 'sub2Months' | 'sub6Months' | 'sub12Months';
  labelKm: string;
  tagKey?: 'subPopular' | 'subBestValue';
  tagKm?: string;
}[] = [
  { key: '1m', months: 1, price: 2, labelKey: 'sub1Month', labelKm: '១ ខែ' },
  { key: '2m', months: 2, price: 4, labelKey: 'sub2Months', labelKm: '២ ខែ' },
  { key: '6m', months: 6, price: 7, labelKey: 'sub6Months', labelKm: '៦ ខែ', tagKey: 'subPopular', tagKm: 'ពេញនិយម' },
  { key: '1y', months: 12, price: 28, labelKey: 'sub12Months', labelKm: '១២ ខែ', tagKey: 'subBestValue', tagKm: 'ល្អបំផុត' },
];

const PLAN_QR: Record<PlanKey, string> = {
  '1m': '/assets/images/subscription-1m.png',
  '2m': '/assets/images/subscription-2m.png',
  '6m': '/assets/images/subscription-6m.png',
  '1y': '/assets/images/subscription-1y.png',
};

const KHQR_MERCHANT_NAME = 'PANG SOK HENG S2_Nint.Ani';

// Baseline per-month rate (the 1-month plan) used only to compute an honest
// "Save X%" badge for longer plans — never shown when a plan isn't actually
// cheaper per month than the baseline.
const BASE_PER_MONTH = PLANS[0].price / PLANS[0].months;
const savingsPct = (p: (typeof PLANS)[number]) => {
  const perMonth = p.price / p.months;
  const pct = Math.round((1 - perMonth / BASE_PER_MONTH) * 100);
  return pct > 0 ? pct : 0;
};

// 3-minute wait window shown in the modal. The webhook itself does not
// enforce this — a late notification can still confirm the request
// after the on-screen timer runs out — this is just how long we keep
// the user watching before switching to the "try again" screen.
const COUNTDOWN_SECONDS = 180;
const POLL_INTERVAL_MS = 3000;

interface Props {
  onClose: () => void;
}

type Step = 'summary' | 'qr' | 'success' | 'timeout' | 'failed';

export default function SubscriptionModal({ onClose }: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const km = lang === 'km';

  const [selected, setSelected] = useState<PlanKey>('6m');
  const [step, setStep] = useState<Step>('summary');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [paying, setPaying] = useState(false);
  const [qrLoaded, setQrLoaded] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const [qrSaved, setQrSaved] = useState(false);
  const [matchCode, setMatchCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedPlan = PLANS.find((p) => p.key === selected)!;

  const stopTimers = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  };

  // Best-effort: mark an abandoned request as no longer pending, so the
  // telegram-webhook's `.eq('status','pending')` lookup stops treating
  // its match_code as live. Two things can make this silently do
  // nothing, so we guard against both:
  //   1. 'cancelled' may not exist as a valid value for this column yet
  //      — if the update errors, we fall back to 'failed', which is
  //      already used elsewhere and needs no schema change.
  //   2. Supabase's client does NOT return an error when a row-level
  //      security policy blocks the write — it just reports 0 rows
  //      updated. We check for that explicitly and warn in the console
  //      so a missing UPDATE policy is visible instead of invisible.
  const cancelRequest = async (id: string) => {
    try {
      const first = await supabase
        .from('subscription_requests')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id');

      if (first.error) {
        const fallback = await supabase
          .from('subscription_requests')
          .update({ status: 'failed' })
          .eq('id', id)
          .eq('status', 'pending')
          .select('id');
        if (fallback.error || !fallback.data?.length) {
          console.warn('[subscription] could not cancel pending request', id, fallback.error);
        }
      } else if (!first.data?.length) {
        console.warn(
          '[subscription] cancel affected 0 rows for request',
          id,
          '— either it was already confirmed, or an UPDATE policy on subscription_requests is missing/blocking this.',
        );
      }
    } catch (err) {
      console.warn('[subscription] cancelRequest failed', id, err);
    }
  };

  useEffect(() => () => stopTimers(), []);

  useEffect(() => {
    setQrLoaded(false);
    setQrFailed(false);
    setQrSaved(false);
  }, [selected]);

  const saveQr = async () => {
    setQrSaved(true);
    try {
      const res = await fetch(PLAN_QR[selected]);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nint-anime-qr-${selected}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      const a = document.createElement('a');
      a.href = PLAN_QR[selected];
      a.download = `nint-anime-qr-${selected}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  };

  const copyMatchCode = async () => {
    if (!matchCode) return;
    try {
      await navigator.clipboard.writeText(matchCode);
    } catch {
      // Clipboard API unavailable — the code is still shown on screen
      // for the user to type manually.
    }
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const startListening = (newRequestId: string, code: string | null) => {
    setSecondsLeft(COUNTDOWN_SECONDS);
    setStep('qr');
    setQrSaved(false);
    setCodeCopied(false);
    setMatchCode(code);
    setRequestId(newRequestId);
    let remaining = COUNTDOWN_SECONDS;
    stopTimers();
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setSecondsLeft(remaining);
      if (remaining <= 0) { stopTimers(); setStep('timeout'); }
    }, 1000);
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('subscription_requests')
        .select('status')
        .eq('id', newRequestId)
        .maybeSingle();
      if (data?.status === 'confirmed') { stopTimers(); setStep('success'); }
      else if (data?.status === 'failed') { stopTimers(); setStep('failed'); }
    }, POLL_INTERVAL_MS);
  };

  const doCreateRequest = async (isRetry: boolean) => {
    setError('');
    setPaying(true);
    // A leftover pending request from a prior attempt (timed out, or
    // abandoned and re-opened) should never keep listening once we're
    // about to mint a new match_code for the same purchase.
    if (requestId) {
      cancelRequest(requestId);
      setRequestId(null);
      setMatchCode(null);
    }
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { setError(t.subNotSignedIn); return; }
      const { data, error: insertError } = await supabase
        .from('subscription_requests')
        .insert({
          user_id: userData.user.id,
          plan: selectedPlan.key,
          amount: selectedPlan.price,
          discount: 0,
          description: isRetry ? 'Awaiting Telegram auto-confirm (retry)' : 'Awaiting Telegram auto-confirm',
        })
        .select('id, match_code')
        .single();
      if (insertError || !data) { setError(insertError?.message || t.subQrGenericError); return; }
      startListening(data.id, (data as { match_code?: string | null }).match_code ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.subQrGenericError);
    } finally {
      setPaying(false);
    }
  };

  // Closing the modal (X, or the backdrop) while a request is pending
  // abandons that request: cancel it so its match_code stops being a
  // live target for the webhook, and the next "Pay" always starts fresh.
  const handleClose = () => {
    stopTimers();
    if (requestId && (step === 'qr' || step === 'timeout' || step === 'failed')) {
      cancelRequest(requestId);
      setRequestId(null);
      setMatchCode(null);
    }
    onClose();
  };

  // "Back" also abandons the current pending request — same reasoning
  // as handleClose, just returning to plan selection instead of exiting.
  const handleBack = () => {
    stopTimers();
    if (requestId) {
      cancelRequest(requestId);
      setRequestId(null);
      setMatchCode(null);
    }
    setStep('summary');
  };

  const urgent = secondsLeft <= 10;
  const countdownProgress = secondsLeft / COUNTDOWN_SECONDS;

  const planLabel = (p: typeof PLANS[number]) =>
    km ? p.labelKm : t[p.labelKey];

  const tagLabel = (p: typeof PLANS[number]) =>
    p.tagKey ? (km ? p.tagKm! : t[p.tagKey]) : '';

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden p-4"
      style={{ backgroundColor: 'rgba(4,4,10,0.72)', backdropFilter: 'blur(10px)' }}
      onClick={step !== 'qr' ? handleClose : undefined}
    >
      {/* Atmospheric silhouette backdrop — large dim watermark + amber glow, no click target */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src={LOGO_URL}
          alt=""
          aria-hidden="true"
          className="absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 select-none object-contain opacity-[0.05] blur-[2px]"
        />
        <div
          className="absolute left-1/2 top-1/2 h-[70vh] w-[70vh] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: `radial-gradient(circle,${COLOR.gold}1A 0%,${COLOR.gold}00 65%)` }}
        />
        {/* Vignette shadow — darkens the edges so the centered card reads with depth,
            instead of a flat opaque wash covering the whole screen */}
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 35%,rgba(0,0,0,0.55) 100%)' }}
        />
      </div>

      <div
        className={`relative w-full overflow-y-auto text-white ${km ? 'font-khmer' : ''}`}
        style={{
          maxWidth: 372,
          maxHeight: '92vh',
          background: 'linear-gradient(175deg,#1c1a2b 0%,#0c0b14 100%)',
          border: `1px solid ${COLOR.gold}24`,
          borderRadius: 28,
          boxShadow: `0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03), 0 30px 80px -20px ${COLOR.gold}26`,
          scrollbarWidth: 'none',
          // Khmer script stacks vowels/subscripts above & below the base
          // consonant — the default ~1.15 line-height clips them at small
          // sizes. 1.55 gives them room without visibly loosening the
          // Latin/number-only lines (those already pin leading-none).
          lineHeight: 1.55,
        }}
        onClick={(e) => e.stopPropagation()}
      >

        {/* ═══════════════ PLAN SELECTION ═══════════════ */}
        {(step === 'summary' || step === 'timeout' || step === 'failed') && (
          <div className="flex flex-col">
            {/* Header */}
            <div className="relative px-4 pb-2 pt-5 text-center">
              <button
                onClick={handleClose}
                aria-label={t.subCloseBtn}
                className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/10"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}
              >
                <X size={15} />
              </button>

              {/* Logo — large, centered, no background plate */}
              <div className="mx-auto mb-2 h-24 w-24 drop-shadow-[0_4px_20px_rgba(232,169,74,0.25)]">
                <img
                  src={LOGO_URL}
                  alt="NINT ANIME"
                  className="h-full w-full object-contain"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>

              <h2 className="flex items-center justify-center gap-1.5 text-[20px] font-extrabold text-white">
                <Crown size={17} fill={COLOR.gold} strokeWidth={0} />
                {t.subGoPremium}
              </h2>
              <p className="mt-1 flex items-center justify-center gap-1.5 text-[12px] font-medium text-white/40">
                <Sparkles size={9} style={{ color: COLOR.gold }} />
                {t.subTagline}
              </p>
            </div>

            {/* Scrollable body */}
            <div className="px-3.5 pb-4 pt-2">

              {/* Timeout / failed notice */}
              {(step === 'timeout' || step === 'failed') && (
                <div
                  className="mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5"
                  style={{ border: `1px solid ${COLOR.error}33`, background: `${COLOR.error}12` }}
                >
                  <AlertCircle size={13} className="mt-0.5 shrink-0" style={{ color: COLOR.error }} />
                  <p className="text-[11px] leading-relaxed" style={{ color: `${COLOR.error}CC` }}>
                    {step === 'failed'
                      ? (km ? 'មិនអាចបញ្ជាក់ការទូទាត់នេះបានទេ សូមព្យាយាមម្ដងទៀត' : 'This payment could not be confirmed. Please try again.')
                      : t.subTimeoutDesc}
                  </p>
                </div>
              )}

              {/* Plan grid 2×2 */}
              <div className="grid grid-cols-2 gap-2">
                {PLANS.map((p) => {
                  const isSel = selected === p.key;
                  const save = savingsPct(p);
                  return (
                    <button
                      key={p.key}
                      onClick={() => setSelected(p.key)}
                      aria-pressed={isSel}
                      className="relative rounded-2xl text-left transition-all duration-150 active:scale-[0.97]"
                      style={{
                        border: isSel ? `1.5px solid ${COLOR.gold}` : '1.5px solid rgba(255,255,255,0.06)',
                        background: isSel
                          ? 'linear-gradient(150deg,rgba(40,30,8,1) 0%,rgba(24,18,4,1) 100%)'
                          : 'rgba(255,255,255,0.025)',
                        boxShadow: isSel ? `0 0 0 3px ${COLOR.gold}1F` : 'none',
                        padding: '20px 12px 12px',
                      }}
                    >
                      {/* Badge — centered top edge */}
                      {p.tagKey && (
                        <span
                          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 top-0 inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-black"
                          style={{ background: `linear-gradient(90deg,${COLOR.gold},${COLOR.goldDeep})` }}
                        >
                          <Sparkles size={6} />
                          {tagLabel(p)}
                        </span>
                      )}

                      {/* Selected check */}
                      {isSel && (
                        <CheckCircle2
                          size={15}
                          className="absolute right-2.5 top-2.5"
                          style={{ color: COLOR.gold }}
                          fill="rgba(232,169,74,0.18)"
                        />
                      )}

                      <p className="text-[11px] font-medium text-white/40">{planLabel(p)}</p>
                      <p
                        className="mt-0.5 text-[28px] font-black leading-none tracking-tight"
                        style={{ color: isSel ? COLOR.gold : COLOR.primaryLight, fontFamily: DISPLAY_FONT }}
                      >
                        ${p.price}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <p className="text-[11px] text-white/30">
                          ${(p.price / p.months).toFixed(2)}/{km ? 'ខែ' : 'mo'}
                        </p>
                        {save > 0 && (
                          <span
                            className="rounded-full px-1.5 py-[1px] text-[9px] font-bold"
                            style={{ background: `${COLOR.primary}26`, color: COLOR.primaryLight }}
                          >
                            {t.subSaveBadge} {save}%
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Summary card — total due + what's included, merged into one
                  block so the eye isn't bouncing between two separate boxes */}
              <div
                className="mt-2.5 rounded-2xl px-3.5 py-3"
                style={{
                  border: `1px solid ${COLOR.primary}26`,
                  background: `${COLOR.primary}0F`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: `linear-gradient(135deg,${COLOR.primary},${COLOR.primaryDeep})` }}
                  >
                    <Crown size={16} className="text-white" fill="white" strokeWidth={0} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-white/70">{t.subTotalDue}</p>
                    <p className="truncate text-[11px] text-white/35">{planLabel(selectedPlan)}</p>
                  </div>
                  <p
                    className="text-[26px] font-black leading-none text-white"
                    style={{ fontFamily: DISPLAY_FONT }}
                  >
                    ${selectedPlan.price}
                  </p>
                </div>
                <div className="mt-2.5 flex items-center gap-1.5 border-t border-white/[0.06] pt-2.5 text-[11px] text-white/40">
                  <ScanLine size={11} style={{ color: COLOR.primaryLight }} />
                  {km
                    ? 'ស្កេន KHQR ដើម្បីទូទាត់ — ដោះសោ VIP ដោយស្វ័យប្រវត្តិភ្លាមៗ'
                    : 'Pay by scanning a KHQR — VIP unlocks automatically, instantly'}
                </div>
              </div>

              {error && (
                <p
                  className="mt-2 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px]"
                  style={{ background: `${COLOR.error}1A`, color: COLOR.error }}
                >
                  <AlertCircle size={12} className="shrink-0" />
                  {error}
                </p>
              )}

              {/* Pay button */}
              <button
                onClick={() => doCreateRequest(step === 'timeout' || step === 'failed')}
                disabled={paying}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[13px] font-bold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                style={{ background: `linear-gradient(135deg,${COLOR.primary} 0%,${COLOR.primaryDeep} 100%)` }}
              >
                {paying ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Ticket size={16} />
                )}
                {step === 'timeout' || step === 'failed' ? t.subTryAgain : t.subPayNow}
              </button>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-center gap-1.5 border-t border-white/[0.04] py-2.5">
              <ShieldCheck size={9} className="text-white/25" />
              <p className="text-[11px] text-white/25">{t.subSecFooter}</p>
            </div>
          </div>
        )}

        {/* ═══════════════ QR PAYMENT STEP ═══════════════ */}
        {step === 'qr' && (
          <div className="flex flex-col overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center justify-between px-3.5 pb-2 pt-4">
              <button
                onClick={handleBack}
                className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] font-medium text-white/60 transition hover:bg-white/08 hover:text-white"
                style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)' }}
              >
                <ArrowLeft size={13} />
                {t.subBackBtn}
              </button>

              {/* Countdown — pill + slim progress bar so the remaining time
                  is legible at a glance, not just a ticking number */}
              <div className="flex flex-col items-center gap-1">
                <div
                  className="rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums"
                  style={{
                    color: urgent ? COLOR.error : COLOR.gold,
                    background: urgent ? `${COLOR.error}1A` : `${COLOR.gold}1A`,
                  }}
                >
                  {String(Math.floor(secondsLeft / 60)).padStart(1, '0')}:{String(secondsLeft % 60).padStart(2, '0')}
                </div>
                <div className="h-[3px] w-14 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full transition-[width] duration-1000 ease-linear"
                    style={{
                      width: `${Math.max(countdownProgress, 0) * 100}%`,
                      background: urgent ? COLOR.error : COLOR.gold,
                    }}
                  />
                </div>
              </div>

              <button
                onClick={handleClose}
                aria-label={t.subCloseBtn}
                className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/10"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.45)' }}
              >
                <X size={14} />
              </button>
            </div>

            {/* ── Ticket-style payment card ────────────────────────────
                One "VIP access pass" object instead of three stacked
                boxes: a stub (plan + step 1) torn from a QR panel
                (step 2 + code), joined by a perforated seam. */}
            <div className="px-5 pb-1 pt-1">
              <div
                className="relative overflow-hidden rounded-[22px]"
                style={{
                  border: `1px solid ${COLOR.gold}3D`,
                  background: 'linear-gradient(155deg,rgba(40,30,8,0.9) 0%,rgba(18,15,10,0.95) 55%)',
                  boxShadow: `0 16px 40px rgba(0,0,0,0.45), 0 0 0 1px ${COLOR.gold}14`,
                }}
              >
                {/* Stub — plan + step 1 */}
                <div className="px-4 pb-4 pt-3.5 text-center">
                  <p
                    className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: COLOR.gold }}
                  >
                    <Ticket size={10} />
                    {t.subTicketEyebrow}
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-white">
                    {planLabel(selectedPlan)} · ${selectedPlan.price}
                  </p>
                  <div className="mx-auto mt-2.5 max-w-[260px]">
                    <p className="flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white/85">
                      <ScanLine size={12} style={{ color: COLOR.gold }} />
                      {t.subStepScanTitle}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                      {t.subStepScanDesc}
                    </p>
                  </div>
                </div>

                {/* Perforated seam */}
                <div className="relative h-0">
                  <div
                    className="absolute -left-2.5 top-0 h-5 w-5 -translate-y-1/2 rounded-full"
                    style={{ background: '#0c0b14' }}
                  />
                  <div
                    className="absolute -right-2.5 top-0 h-5 w-5 -translate-y-1/2 rounded-full"
                    style={{ background: '#0c0b14' }}
                  />
                  <div
                    className="mx-6 border-t border-dashed"
                    style={{ borderColor: `${COLOR.gold}40` }}
                  />
                </div>

                {/* Match code — the ONLY signal the webhook uses to confirm
                    a payment (see telegram-webhook). It's globally unique
                    per request, so it can never be confused with anyone
                    else's payment even if several people pay the same plan
                    at once. The user must type it into the ABA "Message /
                    Note" field before confirming the transfer. */}
                {matchCode && (
                  <div className="px-5 pb-3 pt-4">
                    <p
                      className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]"
                      style={{ color: COLOR.gold }}
                    >
                      {t.subStepCodeTitle}
                    </p>

                    {/* Segmented "OTP cell" layout — each character gets
                        its own tile so the code is unmistakable at a
                        glance and easy to copy character-by-character
                        into the bank app if clipboard paste ever fails. */}
                    <div className="mt-2 flex items-center justify-center gap-[5px]">
                      {matchCode.split('').map((ch, i) => (
                        <div
                          key={i}
                          className="flex h-11 w-8 items-center justify-center rounded-[10px] text-[19px] font-black text-white"
                          style={{
                            fontFamily: DISPLAY_FONT,
                            border: `1px solid ${COLOR.gold}45`,
                            background: `linear-gradient(180deg,${COLOR.gold}1C,${COLOR.gold}0A)`,
                            boxShadow: `0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)`,
                          }}
                        >
                          {ch}
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={copyMatchCode}
                      className="mx-auto mt-2.5 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[11px] font-semibold transition active:scale-[0.97]"
                      style={{
                        background: codeCopied ? `${COLOR.primary}26` : 'rgba(255,255,255,0.08)',
                        color: codeCopied ? COLOR.primaryLight : 'rgba(255,255,255,0.7)',
                        border: `1px solid ${codeCopied ? `${COLOR.primary}40` : 'rgba(255,255,255,0.08)'}`,
                      }}
                    >
                      {codeCopied ? <Check size={12} /> : <Copy size={12} />}
                      {codeCopied ? t.subCopiedBtn : t.subCopyBtn}
                    </button>

                    <p className="mx-auto mt-2 max-w-[230px] text-center text-[10px] leading-relaxed text-white/30">
                      {t.subStepCodeDesc}
                    </p>
                  </div>
                )}

                {/* QR — small, contained, framed in its own white panel so
                    it stays crisp and scannable at a compact size. The PNG
                    already contains the header, merchant name, amount &
                    QR, so we just frame the image (no duplicate text). */}
                <div className="px-6 pb-4">
                  <div
                    className="relative mx-auto overflow-hidden rounded-2xl bg-white p-2"
                    style={{
                      maxWidth: 168,
                      boxShadow: '0 10px 26px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.04)',
                    }}
                  >
                    {!qrLoaded && !qrFailed && (
                      <div className="flex aspect-[3/4] items-center justify-center rounded-xl bg-gray-50">
                        <Loader2 size={20} className="animate-spin text-gray-300" />
                      </div>
                    )}
                    {qrFailed ? (
                      <div className="flex aspect-[3/4] flex-col items-center justify-center rounded-xl bg-gray-50 text-center">
                        <ScanLine size={30} className="mx-auto mb-1.5 text-gray-300" />
                        <p className="text-[11px] text-gray-400">
                          {km ? 'មិនអាចផ្ទុក QR បានទេ' : 'QR not available'}
                        </p>
                      </div>
                    ) : (
                      <img
                        src={PLAN_QR[selected]}
                        alt={`KHQR ${KHQR_MERCHANT_NAME} $${selectedPlan.price}`}
                        className="block w-full rounded-xl"
                        style={{ display: qrLoaded ? 'block' : 'none' }}
                        onLoad={() => setQrLoaded(true)}
                        onError={() => { setQrFailed(true); setQrLoaded(true); }}
                      />
                    )}
                  </div>
                </div>

                {/* Save button — lives inside the card now, as its own
                    strip below the QR, separated by a hairline rather
                    than floating below the ticket as a detached control. */}
                <div
                  className="px-6 pb-4 pt-1"
                  style={{ borderTop: `1px solid ${COLOR.gold}1F` }}
                >
                  <button
                    onClick={saveQr}
                    className="mx-auto mt-3 flex items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-[12px] font-semibold transition hover:brightness-110 active:scale-[0.98]"
                    style={{
                      border: `1.5px solid ${COLOR.gold}40`,
                      background: `${COLOR.gold}14`,
                      color: COLOR.gold,
                    }}
                  >
                    {qrSaved ? <Check size={13} /> : <Download size={13} />}
                    {t.subSaveQr}
                  </button>
                </div>
              </div>
            </div>

            {/* "Waiting for payment" notice — shown as soon as the QR
                step opens, in step with the cooldown above, rather than
                gated behind the Save QR button. */}
            <div
              className="mx-4 mb-2 flex animate-slide-up-fade items-center gap-2.5 rounded-2xl px-3.5 py-3"
              style={{
                border: `1px solid ${COLOR.primary}40`,
                background: `linear-gradient(135deg,${COLOR.primary}1F,${COLOR.primary}0A)`,
                boxShadow: `0 8px 24px -8px ${COLOR.primary}59`,
              }}
            >
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ background: `${COLOR.primary}26` }}
              >
                <Loader2 size={13} className="animate-spin" style={{ color: COLOR.primaryLight }} />
              </div>
              <div>
                <p className="text-[12px] font-semibold text-white/80">{t.subWaitingPayment}</p>
                <p className="text-[11px] text-white/40">{t.subAutoUnlockNote}</p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-center gap-1.5 border-t border-white/[0.04] py-2.5">
              <ShieldCheck size={9} className="text-white/25" />
              <p className="text-[11px] text-white/25">{t.subSecFooter}</p>
            </div>
          </div>
        )}

        {/* ═══════════════ SUCCESS ═══════════════ */}
        {step === 'success' && (
          <div className="flex flex-col items-center px-5 py-10 text-center">
            <div
              className="mb-5 flex h-20 w-20 items-center justify-center rounded-full"
              style={{ background: `radial-gradient(circle,${COLOR.success}33,${COLOR.success}0A)` }}
            >
              <CheckCircle2 size={42} style={{ color: COLOR.success }} />
            </div>
            <p className="flex items-center gap-1.5 text-[16px] font-bold text-white">
              <Crown size={15} fill={COLOR.gold} strokeWidth={0} />
              {t.subYourePremium}
            </p>
            <p className="mx-auto mt-2 max-w-[240px] text-[12px] leading-relaxed text-white/50">
              {t.subConfirmedDesc}
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-2xl px-8 py-3 text-[13px] font-bold text-white transition hover:brightness-110 active:scale-[0.98]"
              style={{ background: `linear-gradient(135deg,${COLOR.primary} 0%,${COLOR.primaryDeep} 100%)` }}
            >
              {t.subStartWatching}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
