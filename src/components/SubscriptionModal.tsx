import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  ChevronRight,
  Crown,
  Download,
  ImagePlus,
  Loader2,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import {
  PRICING_TIERS,
  getEffectivePricingTiers,
  getHiddenTierKeys,
  type PricingTier,
  submitPaymentIntent,
  attachScreenshotToSubmission,
  getPendingSubmission,
  getQrCodes,
  createAbaCheckout,
  checkSubmissionStatus,
  getPaymentReceipt,
  type PaymentReceipt,
  expireStaleSubmission,
  cancelPaymentSubmission,
  type PaymentSubmission,
} from '@/lib/subscription';

interface Props {
  onClose: () => void;
  onSubmitted: () => void;
  onApproved: () => void;
  onGoSpin: () => void;
}

// 'pick'   — choose a plan
// 'method' — plan is chosen, now pick how to pay (ABA vs. another bank's
//            KHQR). Nothing is submitted yet — the payment ticket is only
//            opened once a method is actually tapped.
// 'pay'    — the QR + upload screen for whichever method was picked.
type Step = 'pick' | 'method' | 'pay';
type PayMethod = 'aba' | 'qr';

// How long one payment ticket stays open while the ABA auto-confirm
// webhook listens for a matching bank notification. When this hits zero
// with (a) no real ABA match and (b) no receipt photo attached, the
// ticket is auto-rejected server-side and a fresh one is opened in its
// place — see the recycle effect below.
const WAIT_WINDOW_SECONDS = 180;

// Keyed by DURATION, not by tier key. Keying on the key is how the
// '2m' slot ended up showing a one-month icon after it was re-priced
// to three months — the key is an immutable internal id and says
// nothing about what the plan currently sells. Months is the fact the
// icon is actually illustrating, so it can never drift.
function tierIcon(months: number) {
  if (months >= 12) return Crown;   // the full year — the top tier
  if (months >= 6) return Star;
  if (months >= 3) return Sparkles;
  return Zap;                        // short, quick start
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
  // Which way the viewer chose to pay — picked on the 'method' sheet,
  // used on 'pay' only to swap a bit of copy (the ABA screenshot note)
  // and the download filename. Both methods share the exact same QR +
  // upload-a-receipt UI underneath.
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PaymentSubmission | null>(null);
  const [checkingPending, setCheckingPending] = useState(true);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<PricingTier[]>(PRICING_TIERS);
  const [secondsLeft, setSecondsLeft] = useState(WAIT_WINDOW_SECONDS);
  const [decision, setDecision] = useState<'waiting' | 'approved' | 'rejected'>('waiting');
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [attachingProof, setAttachingProof] = useState(false);
  const [proofSent, setProofSent] = useState(false);
  // Manual-pay staging: the viewer picks a screenshot first and reviews
  // it, then taps Pay to actually submit it. Nothing is uploaded (and the
  // admin is not messaged) until that Pay tap.
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  // Guards the live payment ticket from an accidental exit: the X button
  // and the bottom Close button both route through requestClose(), which
  // raises this instead of closing outright while a ticket is open and
  // still waiting on a decision. Only confirming "Exit" here, or the
  // ticket actually getting approved/rejected, is allowed to close the
  // screen from that point on.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const notifiedApprovedRef = useRef(false);
  const recyclingRef = useRef(false);

  // Loaded from app_settings, not hardcoded — see getHiddenTierKeys().
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const visibleTiers = useMemo(
    () => tiers.filter((tr) => !hiddenKeys.has(tr.key)),
    [tiers, hiddenKeys],
  );

  useEffect(() => {
    getPendingSubmission().then((p) => {
      setPending(p);
      setCheckingPending(false);
      if (p) {
        setSelectedKey(p.tier);
        // Resume the countdown from where it actually should be, based
        // on when the row was created — not a fresh 3 minutes just
        // because the modal was reopened.
        const elapsedSec = Math.floor((Date.now() - new Date(p.submitted_at).getTime()) / 1000);
        setSecondsLeft(Math.max(0, WAIT_WINDOW_SECONDS - elapsedSec));
        // A resumed ticket has no way to know which method the viewer
        // picked last time (that choice only ever lived in this
        // component's state) — 'qr' is the safer default since it never
        // implies an ABA-specific flow that wasn't actually chosen.
        setPayMethod((cur) => cur ?? 'qr');
        setStep('pay');
      }
    });
    getQrCodes().then(setQrImages);
    // Both are needed before a plan can be preselected, so they resolve
    // together rather than racing each other into setState.
    Promise.all([getEffectivePricingTiers(), getHiddenTierKeys()]).then(([rows, hidden]) => {
      setTiers(rows);
      setHiddenKeys(hidden);
      // Preselect the plan flagged "best" so the CTA is never dead on
      // arrival — the viewer can still change it before paying.
      setSelectedKey((cur) => {
        if (cur) return cur;
        const offered = rows.filter((r) => !hidden.has(r.key));
        return (offered.find((r) => r.badge === 'best') ?? offered[0])?.key ?? null;
      });
    });
  }, []);

  // Polls for a decision while a ticket is open. Both the ABA
  // auto-confirm webhook and the admin's manual Approve/Reject write the
  // same status column, so one poll covers both paths.
  useEffect(() => {
    if (step !== 'pay' || !pending || decision !== 'waiting') return;

    const pollInterval = window.setInterval(async () => {
      if (recyclingRef.current) return;
      const status = await checkSubmissionStatus(pending.id);
      if (recyclingRef.current) return;
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

  // The 3-minute window ran out with no ABA match and no receipt photo:
  // close the stale ticket (server-side, so it can never grant anything)
  // and open a fresh one for the same plan. Keeping stale pending rows
  // around would let the ABA matcher attach a later, unrelated payment
  // to an abandoned ticket — closing them keeps matching honest, and the
  // viewer keeps a live ticket without having to start over by hand.
  useEffect(() => {
    if (step !== 'pay' || !pending || decision !== 'waiting') return;
    if (secondsLeft > 0 || proofSent || attachingProof || recyclingRef.current) return;

    recyclingRef.current = true;
    (async () => {
      const tier = tiers.find((tr) => tr.key === pending.tier);
      const closed = await expireStaleSubmission(pending.id);
      // A false return means two different things — the SQL helper isn't
      // installed, or the row no longer qualifies because something else
      // already decided it. Re-read the status rather than guessing:
      // treating an already-closed ticket as "keep listening" is what
      // would leave the viewer staring at a rejection screen.
      const status = closed ? 'rejected' : await checkSubmissionStatus(pending.id);

      if (status === 'approved') {
        setDecision('approved');
        recyclingRef.current = false;
        return;
      }
      if (status === 'pending' || !tier) {
        recyclingRef.current = false;
        setSecondsLeft(WAIT_WINDOW_SECONDS);
        return;
      }

      const { id } = await submitPaymentIntent({ tierKey: tier.key, amount: tier.price });
      const fresh = await getPendingSubmission();
      if (id && fresh) {
        setPending(fresh);
        setAbaCheckout(await createAbaCheckout(fresh.id));
      }
      setSecondsLeft(WAIT_WINDOW_SECONDS);
      recyclingRef.current = false;
    })();
  }, [secondsLeft, step, pending, decision, proofSent, attachingProof, tiers]);

  // Confirmation is now the ONLY thing that ends the wait — there is no
  // "I have paid" button to press any more, because a button like that
  // only ever restated what the poll already knew. The moment the ticket
  // flips to approved we unlock and show the receipt ourselves, which is
  // how every real checkout behaves.
  useEffect(() => {
    if (decision !== 'approved' || notifiedApprovedRef.current) return;
    notifiedApprovedRef.current = true;
    onApproved();
    if (pending) getPaymentReceipt(pending.id).then(setReceipt);
  }, [decision, onApproved, pending]);

  const tier = visibleTiers.find((tr) => tr.key === selectedKey) ?? null;
  const payTier = tiers.find((tr) => tr.key === (pending?.tier ?? selectedKey)) ?? null;
  const qrSrc = payTier ? qrImages[payTier.key] || FALLBACK_QR_IMAGES[payTier.key] : null;

  // "Select Payment" on the picker just opens the method sheet — nothing
  // is submitted yet. The actual ticket only opens once a method is
  // tapped, in handleSelectMethod below.
  const handleOpenMethodSheet = () => {
    if (!tier) return;
    setError('');
    setStep('method');
  };

  // A method was tapped on the sheet: open the payment ticket (QR +
  // upload screen) for it. The admin is not messaged at this point any
  // more — only once there's something for them to actually act on: an
  // ABA webhook match, or the viewer submitting a receipt photo (see
  // handleAttachProof / confirm-payment-proof, which sends the photo
  // itself with Confirm/Revoke buttons).
  const handleSelectMethod = async (method: PayMethod) => {
    if (!tier) return;
    setError('');
    setSubmitting(true);
    const { error: err, id } = await submitPaymentIntent({
      tierKey: tier.key,
      amount: tier.price,
    });
    setSubmitting(false);
    if (err || !id) {
      setError(err ?? t.subQrGenericError);
      setStep('pick');
      return;
    }
    onSubmitted();
    setPayMethod(method);
    setSecondsLeft(WAIT_WINDOW_SECONDS);
    setDecision('waiting');
    setReceipt(null);
    setProofSent(false);
    setProofFile(null);
    setProofPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    recyclingRef.current = false;
    const fresh = await getPendingSubmission();
    if (fresh) {
      setPending(fresh);
      // Fire-and-forget: still lets the ABA webhook auto-match this
      // ticket in the background even though the app no longer shows a
      // deeplink for it — the viewer's own path to unlock is now always
      // the receipt upload below.
      if (method === 'aba') createAbaCheckout(fresh.id);
    }
    setStep('pay');
  };

  const handleAttachProof = async (file: File) => {
    if (!pending) return;
    setAttachingProof(true);
    setError('');
    const { error: err } = await attachScreenshotToSubmission(pending.id, file);
    setAttachingProof(false);
    if (err) {
      setError(err);
      return;
    }
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofPreviewUrl(null);
    setProofFile(null);
    setProofSent(true);
    // No separate notify call — confirm-payment-proof already grants VIP
    // and forwards the photo to the admin with Confirm/Revoke buttons.
    // The poll above picks up the resulting 'approved' status, usually
    // within a few seconds.
  };

  // Manual tab, step 1: just stage the picked screenshot locally for
  // review — nothing is uploaded and the admin isn't messaged yet.
  const handlePickProof = (file: File) => {
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setError('');
    setProofFile(file);
    setProofPreviewUrl(URL.createObjectURL(file));
  };

  // Manual tab, step 2: viewer reviewed the screenshot and taps Pay —
  // this is the actual submit, which uploads the photo and pings admin.
  const handleConfirmManualPay = () => {
    if (proofFile) handleAttachProof(proofFile);
  };

  const handleDiscardPickedProof = () => {
    if (attachingProof) return;
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofFile(null);
    setProofPreviewUrl(null);
  };

  // "Change Plan" — the viewer decided they want a different tier mid-
  // ticket. Cancels the open ticket right away (no 150s floor, unlike the
  // background auto-expire) and drops back to the picker with a clean
  // slate. Guards against the recycle effect firing on the ticket we're
  // about to close out from under it.
  const handleChangePlan = async () => {
    recyclingRef.current = true;
    if (pending) await cancelPaymentSubmission(pending.id);
    setStep('pick');
    setPending(null);
    setPayMethod(null);
    setDecision('waiting');
    setSecondsLeft(WAIT_WINDOW_SECONDS);
    setReceipt(null);
    setProofSent(false);
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofFile(null);
    setProofPreviewUrl(null);
    recyclingRef.current = false;
  };

  // Both the header X and the bottom "Close" button funnel through here.
  // While a ticket is genuinely open and still waiting, closing is never
  // silent — the exit-confirm sheet is the only way out from there,
  // short of the ticket itself getting approved or rejected. Outside that
  // window (picking a plan, choosing a method, or once there's already a
  // final decision) there's nothing at risk, so it closes right away.
  const requestClose = () => {
    if (step === 'pay' && decision === 'waiting') {
      setShowExitConfirm(true);
      return;
    }
    onClose();
  };

  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-app-deep">
      {/* Aurora backdrop — one quiet atmospheric layer, muted dark blue at
          the top (VIP) fading into violet at the bottom. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 40% at 50% -5%, rgba(255,45,70,0.14) 0%, rgba(4,5,10,0) 62%), radial-gradient(ellipse 80% 45% at 12% 108%, rgba(240,188,85,0.16) 0%, rgba(4,5,10,0) 60%)',
        }}
      />

      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between px-3">
        <button
          onClick={() => (step === 'method' ? setStep('pick') : requestClose())}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 transition active:scale-90 hover:bg-white/10 hover:text-white"
          aria-label={step === 'method' ? t.subBackBtn : t.subCloseBtn}
        >
          {step === 'method' ? <ArrowLeft className="h-4 w-4" /> : <X className="h-4 w-4" />}
        </button>
        <span className="text-[13px] font-bold tracking-wide text-white/75">{t.subGoPremium}</span>
        {step === 'pay' && decision === 'waiting' ? (
          <button
            onClick={handleChangePlan}
            className="flex h-9 items-center gap-1 rounded-xl bg-white/5 px-2.5 text-[11px] font-semibold text-white/55 transition active:scale-95 hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> {t.subChangePlan}
          </button>
        ) : (
          <span className="h-9 w-9" />
        )}
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto px-4 pb-6">
        {checkingPending ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/35" />
          </div>
        ) : step === 'pick' ? (
          /* ---------------------------- PLAN PICKER ---------------------------- */
          <>
            <div className="flex flex-col items-center pb-6 pt-2 text-center">
              <div className="relative mb-3">
                <div className="pointer-events-none absolute inset-[-10px] rounded-2xl bg-[#FF2D46]/20 blur-2xl" />
                <img
                  src="/assets/logo.png"
                  alt="NINT ANIME"
                  className="relative h-[68px] w-[68px] rounded-xl ring-1 ring-[#FF2D46]/35"
                />
              </div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-[#FF2D46]/25 bg-[#FF2D46]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#FF2D46]">
                <Crown className="h-3 w-3" />
                {t.subTicketEyebrow}
              </div>
              <h2
                className="text-[26px] leading-tight text-white"
                style={{ fontFamily: '"Anton", Battambang, Inter, sans-serif', letterSpacing: '0.015em' }}
              >
                {t.subChoosePlan}
              </h2>
              <p className="mt-1 text-xs text-white/45">{t.subTagline}</p>
            </div>

            <div className="space-y-3">
              {visibleTiers.map((tr) => {
                const Icon = tierIcon(tr.months);
                const selected = tr.key === selectedKey;
                const perMonth = tr.months > 1 ? (tr.price / tr.months).toFixed(2) : null;
                return (
                  <button
                    key={tr.key}
                    onClick={() => setSelectedKey(tr.key)}
                    className={`relative w-full overflow-hidden rounded-card border px-3.5 pt-3.5 text-left transition-all active:scale-[0.99] ${
                      selected
                        ? 'border-[#FF2D46]/45 bg-[#FF2D46]/[0.07] pb-0 shadow-[0_6px_20px_-12px_rgba(255,45,70,0.5)] ring-1 ring-inset ring-[#FF2D46]/20'
                        : 'border-white/[0.08] bg-white/[0.025] pb-3.5 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${
                          selected
                            ? 'bg-[#FF2D46]/15 ring-1 ring-[#FF2D46]/40'
                            : 'bg-white/[0.07]'
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${selected ? 'text-[#FFA8B2]' : 'text-white/60'}`} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{lang === 'km' ? tr.labelKm : tr.labelEn}</span>
                          {tr.badge === 'best' && (
                            <span className="rounded-md bg-[#FF2D46]/20 px-2 py-0.5 text-[10px] font-bold text-[#FF2D46]">
                              {t.subBestValue}
                            </span>
                          )}
                          {tr.badge === 'popular' && (
                            <span className="rounded-md border border-[#FF2D46]/40 px-2 py-0.5 text-[10px] font-bold text-[#FF2D46]">
                              {t.subPopular}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-white/40">{tr.pitchKm}</p>
                      </div>

                      <div className="shrink-0 text-right">
                        <span className="text-lg font-extrabold text-white">${tr.price}</span>
                        {perMonth && <p className="text-[10px] text-white/35">${perMonth}{t.subPerMonth}</p>}
                      </div>
                    </div>

                    {/* Ticket stub — the selected plan tears off a perforated
                        strip, echoing the "សំបុត្រចូលប្រើ VIP" (access pass)
                        language the app already uses for membership. */}
                    {selected && (
                      <div className="relative mt-3">
                        <span className="absolute -left-[21px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#04050A]" />
                        <span className="absolute -right-[21px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#04050A]" />
                        <div className="border-t border-dashed border-[#FF2D46]/25" />
                        <div className="flex items-center justify-between py-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#FFA8B2]">
                            <BadgeCheck className="h-3.5 w-3.5" />
                            {t.subSelected}
                          </span>
                          <span className="text-[11px] text-white/40">{t.subFullAccess}</span>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-center gap-4 text-[10px] text-white/35">
              <span className="flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-[#4FE3A3]" /> {t.subInstantUnlock}
              </span>
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-[#FF2D46]" /> {t.subDrawAfterPay}
              </span>
            </div>

            {error && (
              <p className="mt-4 rounded-xl border border-[#FFC24D]/30 bg-[#FFC24D]/10 px-3 py-2 text-xs text-[#FFDA9B]">
                {error}
              </p>
            )}
          </>
        ) : step === 'method' ? (
          /* ---------------------------- PAYMENT METHOD ---------------------------- */
          <div className="flex h-full flex-col pt-2">
            <div className="pb-5 text-center">
              <h2
                className="text-[22px] leading-tight text-white"
                style={{ fontFamily: '"Anton", Battambang, Inter, sans-serif', letterSpacing: '0.015em' }}
              >
                {t.subSelectMethodTitle}
              </h2>
              <p className="mt-1 text-xs text-white/45">{t.subSelectMethodDesc}</p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => handleSelectMethod('aba')}
                disabled={submitting}
                className="flex w-full items-center gap-3 rounded-card border border-[#8098FF]/25 bg-[#8098FF]/[0.08] px-4 py-4 text-left transition active:scale-[0.99] hover:border-[#8098FF]/45 disabled:opacity-50"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#8098FF]/20 ring-1 ring-[#8098FF]/40">
                  <Smartphone className="h-5 w-5 text-[#CBD4FF]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-white">{t.subMethodAba}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-white/45">{t.subMethodAbaDesc}</span>
                </span>
                {submitting ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/40" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSelectMethod('qr')}
                disabled={submitting}
                className="flex w-full items-center gap-3 rounded-card border border-white/[0.08] bg-white/[0.025] px-4 py-4 text-left transition active:scale-[0.99] hover:border-white/20 disabled:opacity-50"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.07]">
                  <QrCode className="h-5 w-5 text-white/60" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-white">{t.subMethodQr}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-white/45">{t.subMethodQrDesc}</span>
                </span>
                {submitting ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/40" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
                )}
              </button>
            </div>

            {error && (
              <p className="mt-4 rounded-xl border border-[#FFC24D]/30 bg-[#FFC24D]/10 px-3 py-2 text-xs text-[#FFDA9B]">
                {error}
              </p>
            )}

            <button
              onClick={() => setStep('pick')}
              className="mt-auto w-full rounded-full border border-white/[0.08] bg-white/[0.03] py-3.5 text-sm font-bold text-white/70 transition active:scale-[0.98] hover:bg-white/[0.07] hover:text-white"
            >
              {t.subBackBtn}
            </button>
          </div>
        ) : decision === 'approved' ? (
          /* ---------------------------- PAID (RECEIPT) ---------------------------- */
          <div className="flex h-full flex-col justify-center gap-5 py-4">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#4FE3A3]/12 ring-1 ring-[#4FE3A3]/30">
                <Check className="h-8 w-8 text-[#4FE3A3]" />
              </div>
              <p className="mt-4 text-lg font-bold text-white">{t.subPaySuccessTitle}</p>
              <p className="mt-1.5 max-w-[19rem] text-xs leading-relaxed text-white/50">
                {t.subPaySuccessDesc}
              </p>
            </div>

            {/* Receipt — the four things a payer screenshots: what they
                bought, what it cost, the bank's own reference (ABA's
                "Trx. ID", so it can be checked against a statement) and
                when it expires. Falls back to the internal ticket id when
                the notification carried no reference. */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-1">
              {(
                [
                  [
                    t.subReceiptPlan,
                    payTier ? (lang === 'km' ? payTier.labelKm : payTier.labelEn) : '—',
                  ],
                  [
                    t.subReceiptAmount,
                    receipt ? `$${receipt.amount.toFixed(2)}` : payTier ? `$${payTier.price}` : '—',
                  ],
                  [
                    t.subReceiptRef,
                    receipt?.abaTrxId ?? (receipt ? receipt.id.slice(0, 8).toUpperCase() : '—'),
                  ],
                  [
                    t.subReceiptExpires,
                    receipt?.expiresAt
                      ? new Date(receipt.expiresAt).toLocaleDateString(
                          lang === 'km' ? 'km-KH' : 'en-GB',
                          { day: '2-digit', month: 'short', year: 'numeric' },
                        )
                      : '—',
                  ],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 border-b border-white/[0.05] py-2.5 last:border-b-0"
                >
                  <span className="shrink-0 text-[11px] text-white/40">{label}</span>
                  <span className="truncate text-xs font-semibold tabular-nums text-white">
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-2.5">
              <button
                onClick={onGoSpin}
                className="btn-primary w-full rounded-full py-3.5 text-sm font-bold"
              >
                <Sparkles className="mr-1.5 inline h-4 w-4" />
                {t.subGoDraw}
              </button>
              <button
                onClick={onClose}
                className="w-full rounded-full border border-white/[0.08] bg-white/[0.03] py-3.5 text-sm font-bold text-white/70 transition active:scale-[0.98] hover:bg-white/[0.07] hover:text-white"
              >
                {t.subStartWatching}
              </button>
            </div>
          </div>
        ) : decision === 'rejected' ? (
          /* ---------------------------- REJECTED ---------------------------- */
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FFC24D]/10">
              <X className="h-8 w-8 text-[#FF6B66]" />
            </div>
            <div>
              <p className="text-lg font-bold text-white">{t.subRejectedTitle}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{t.subRejectedDesc}</p>
            </div>
            <button
              onClick={() => {
                setStep('pick');
                setPending(null);
                setPayMethod(null);
                setDecision('waiting');
                setReceipt(null);
                setProofSent(false);
                if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
                setProofFile(null);
                setProofPreviewUrl(null);
              }}
              className="w-full rounded-full border border-white/10 bg-white/5 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] hover:bg-white/10"
            >
              {t.subTryAgain}
            </button>
          </div>
        ) : (
          /* ---------------------------- PAY / WAIT ---------------------------- */
          <div className="space-y-4 pb-2">
            {/* QR card — stays on screen the whole time; the viewer may
                not have paid yet when this first opens. Bigger amount +
                bigger QR so it reads clearly at a glance. */}
            {payTier && (
              <div className="relative overflow-hidden rounded-2xl border border-[#FF2D46]/20 bg-white/[0.03] p-4 text-center">
                <p className="text-[11px] uppercase tracking-[0.16em] text-white/40">{t.subTotalDue}</p>
                <p className="mt-1 text-[28px] font-extrabold leading-none text-white">
                  ${payTier.price}
                  <span className="ml-1.5 text-sm font-medium text-white/40">
                    / {lang === 'km' ? payTier.labelKm : payTier.labelEn}
                  </span>
                </p>

                {qrSrc ? (
                  <img
                    src={qrSrc}
                    alt="KHQR"
                    className="mx-auto mt-3.5 w-full max-w-[220px] rounded-xl border border-white/10 bg-white p-2 shadow-[0_10px_34px_rgba(0,0,0,0.55)]"
                  />
                ) : (
                  <p className="mt-4 rounded-xl border border-[#FF2D46]/25 bg-[#FF2D46]/5 p-4 text-xs text-[#FF2D46]">
                    {t.subQrMissing}
                  </p>
                )}

                {/* Both payment methods land here — a countdown, the QR
                    (still scannable by hand either way), and a
                    stage-then-submit receipt upload. The only thing that
                    changes between them is a bit of copy: the ABA path
                    gets an extra reminder to screenshot the receipt after
                    paying in the app, since there's no more deeplink
                    button doing that hand-off automatically. */}
                <div className="mt-4 space-y-3">
                  <div className="mx-auto inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] px-4 py-2 text-[13px] font-semibold tabular-nums text-white/75">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF2D46]" />
                    {t.subWaitingPayment} ({mmss})
                  </div>

                  <div className="space-y-3 text-left">
                    {qrSrc && (
                      <a
                        href={qrSrc}
                        download={`nintanime-vip-${payTier.key}.png`}
                        className="flex w-full items-center justify-center gap-2 rounded-full border border-white/15 py-3 text-xs font-bold text-white/70 transition active:scale-[0.98] hover:border-white/35 hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5" /> {t.subSaveQr}
                      </a>
                    )}

                    {payMethod === 'aba' && (
                      <p className="flex items-start gap-1.5 rounded-xl border border-[#8098FF]/25 bg-[#8098FF]/[0.08] px-3 py-2.5 text-[11px] leading-relaxed text-[#CBD4FF]">
                        <Smartphone className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[#A3B4FF]" />
                        {t.subAbaScreenshotNote}
                      </p>
                    )}

                    <p className="text-[11px] leading-relaxed text-white/50">{t.subManualFlowNote}</p>

                    {proofSent ? (
                      <p className="flex items-center justify-center gap-1.5 rounded-xl border border-[#4FE3A3]/25 bg-[#4FE3A3]/[0.07] py-3 text-xs font-semibold text-[#4FE3A3]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.subCheckingPayment}
                      </p>
                    ) : proofFile ? (
                      <div className="space-y-2.5">
                        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20">
                          {proofPreviewUrl && (
                            <img
                              src={proofPreviewUrl}
                              alt=""
                              className="max-h-48 w-full object-contain"
                            />
                          )}
                          <button
                            type="button"
                            onClick={handleDiscardPickedProof}
                            disabled={attachingProof}
                            aria-label={t.subChangePhoto}
                            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 transition active:scale-90 hover:bg-black/80 disabled:opacity-40"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={handleConfirmManualPay}
                          disabled={attachingProof}
                          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#E01E3C] py-3.5 text-sm font-extrabold text-white shadow-[0_10px_26px_-12px_rgba(240,188,85,0.75)] transition active:scale-[0.98] disabled:opacity-50"
                        >
                          {attachingProof ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          {attachingProof ? t.subUploadingProof : t.subPayNow}
                        </button>
                      </div>
                    ) : (
                      <label
                        className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#E01E3C]/40 bg-[#E01E3C]/[0.07] px-3.5 py-3 transition active:scale-[0.99] hover:border-[#E01E3C]/70"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E01E3C]/20">
                          <ImagePlus className="h-4 w-4 text-[#FF8F86]" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-bold text-white">{t.subUploadReceiptCta}</span>
                          <span className="block text-[10px] text-white/40">{t.subUploadReceiptHint}</span>
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handlePickProof(f);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>

                  {/* Reassurance sits directly under the upload area,
                      where the hesitation actually happens. */}
                  <p className="flex items-start justify-center gap-1.5 px-1 text-center text-[10px] leading-relaxed text-white/45">
                    <ShieldCheck className="mt-[1px] h-3 w-3 shrink-0 text-[#7FE3C0]/70" />
                    <span>{t.subGatewayManualNote}</span>
                  </p>
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-[#FFC24D]/30 bg-[#FFC24D]/10 px-3 py-2 text-xs text-[#FFDA9B]">
                {error}
              </p>
            )}

            <button
              onClick={requestClose}
              className="w-full rounded-full border border-white/[0.08] bg-white/[0.03] py-3.5 text-sm font-bold text-white/70 transition active:scale-[0.98] hover:bg-white/[0.07] hover:text-white"
            >
              {t.subCloseBtn}
            </button>

            <p className="pb-2 text-center text-[10px] text-white/25">{t.subSecuredCheckout}</p>
          </div>
        )}
      </main>

      {/* Sticky commit bar — only on the picker, so the price and the
          one action are always reachable no matter how long the list. */}
      {!checkingPending && step === 'pick' && (
        <footer
          className="relative z-10 shrink-0 border-t border-white/[0.08] bar-blur px-4 pt-3"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-[11px] text-white/45">{t.subTotalDue}</span>
            <span className="text-xl font-extrabold text-white">{tier ? `$${tier.price}` : '—'}</span>
          </div>
          <button
            onClick={handleOpenMethodSheet}
            disabled={!tier || submitting}
            className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-4 text-sm font-extrabold disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
            {submitting ? t.subSending : t.subJoinVip}
          </button>
          <p className="mt-2 flex items-center justify-center gap-1 text-[10px] text-white/28">
            <Send className="h-2.5 w-2.5" /> {t.subJoinVipNote}
          </p>
        </footer>
      )}

      {/* Exit confirm — the only thing that's allowed to actually close
          this screen while a ticket is open and still waiting, short of
          the ticket itself getting approved or rejected. Sits above
          everything else in the modal, including the sticky footer. */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-6">
          <div className="w-full max-w-[22rem] rounded-2xl border border-white/10 bg-[#0B0C14] p-5 text-center shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#FFC24D]/12">
              <AlertTriangle className="h-6 w-6 text-[#FFC24D]" />
            </div>
            <p className="mt-3 text-sm font-bold text-white">{t.subExitConfirmTitle}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-white/50">{t.subExitConfirmBody}</p>
            <div className="mt-5 space-y-2.5">
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="btn-primary w-full rounded-full py-3 text-sm font-bold"
              >
                {t.subExitConfirmContinue}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExitConfirm(false);
                  onClose();
                }}
                className="w-full rounded-full border border-white/10 bg-white/5 py-3 text-sm font-bold text-white/70 transition active:scale-[0.98] hover:bg-white/10"
              >
                {t.subExitConfirmExit}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
