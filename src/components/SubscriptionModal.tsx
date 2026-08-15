import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  Check,
  Copy,
  Crown,
  Download,
  ImagePlus,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { openExternalLink, copyToClipboard } from '@/lib/telegram';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import {
  PRICING_TIERS,
  getEffectivePricingTiers,
  type PricingTier,
  submitPaymentIntent,
  attachScreenshotToSubmission,
  getPendingSubmission,
  getQrCodes,
  getPayLinks,
  createAbaCheckout,
  type AbaCheckoutResult,
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

type Step = 'pick' | 'pay';

// How long one payment ticket stays open while the ABA auto-confirm
// webhook listens for a matching bank notification. When this hits zero
// with (a) no real ABA match and (b) no receipt photo attached, the
// ticket is auto-rejected server-side and a fresh one is opened in its
// place — see the recycle effect below.
const WAIT_WINDOW_SECONDS = 180;

// Tiers that exist in the DB but are deliberately not offered in the
// picker any more. The "Bonus" tier was removed at the owner's request:
// every approved payment already unlocks a lucky draw afterwards, so
// selling a separate "bigger bonus" plan just duplicated the 1-month
// plan. Delete the key from this set to bring it back — nothing else
// needs changing.
const HIDDEN_TIER_KEYS = new Set(['2m']);

const TIER_ICON: Record<string, typeof Zap> = {
  '1m': Zap,
  '2m': Sparkles,
  '6m': Star,
  '12m': Crown,
};

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
  const [payMode, setPayMode] = useState<'auto' | 'manual'>('auto');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PaymentSubmission | null>(null);
  const [checkingPending, setCheckingPending] = useState(true);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [payLinks, setPayLinks] = useState<Record<string, string>>({});
  const [payLinkCopied, setPayLinkCopied] = useState(false);
  const [abaCheckout, setAbaCheckout] = useState<AbaCheckoutResult | null>(null);
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
  const notifiedApprovedRef = useRef(false);
  const recyclingRef = useRef(false);

  const visibleTiers = useMemo(() => tiers.filter((tr) => !HIDDEN_TIER_KEYS.has(tr.key)), [tiers]);

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
        setStep('pay');
      }
    });
    getQrCodes().then(setQrImages);
    getPayLinks().then(setPayLinks);
    getEffectivePricingTiers().then((rows) => {
      setTiers(rows);
      // Preselect the plan flagged "best" so the CTA is never dead on
      // arrival — the viewer can still change it before paying.
      setSelectedKey((cur) => {
        if (cur) return cur;
        const offered = rows.filter((r) => !HIDDEN_TIER_KEYS.has(r.key));
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
  // Real gateway (server-verified, opens ABA app directly) takes
  // priority over the static admin-pasted PayWay link, which in turn
  // is only shown when the gateway isn't configured/failed.
  const gatewayLink = abaCheckout?.configured ? abaCheckout.deeplink || abaCheckout.checkoutUrl : null;
  const payLinkSrc = payTier ? gatewayLink || payLinks[payTier.key] || null : null;
  const isRealGateway = Boolean(gatewayLink);

  // "Join VIP" just opens the payment ticket (QR + Auto/Manual screen).
  // The admin is not messaged at this point any more — only once there's
  // something for them to actually act on: an ABA webhook match, or the
  // viewer submitting a receipt photo on the Manual tab (see
  // handleAttachProof / confirm-payment-proof, which sends the photo
  // itself with Confirm/Revoke buttons).
  const handleJoinVip = async () => {
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
      return;
    }
    onSubmitted();
    setSecondsLeft(WAIT_WINDOW_SECONDS);
    setDecision('waiting');
    setReceipt(null);
    setProofSent(false);
    setProofFile(null);
    setProofPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPayMode('auto');
    recyclingRef.current = false;
    const fresh = await getPendingSubmission();
    if (fresh) {
      setPending(fresh);
      setAbaCheckout(await createAbaCheckout(fresh.id));
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
    setAbaCheckout(null);
    setDecision('waiting');
    setSecondsLeft(WAIT_WINDOW_SECONDS);
    setReceipt(null);
    setProofSent(false);
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofFile(null);
    setProofPreviewUrl(null);
    setPayMode('auto');
    recyclingRef.current = false;
  };

  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-[#07070C]">
      {/* Aurora backdrop — one quiet atmospheric layer, muted dark blue at
          the top (VIP) fading into violet at the bottom. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 40% at 50% -5%, rgba(74,114,196,0.14) 0%, rgba(7,7,12,0) 62%), radial-gradient(ellipse 80% 45% at 12% 108%, rgba(122,92,255,0.16) 0%, rgba(7,7,12,0) 60%)',
        }}
      />

      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between px-3">
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 transition active:scale-90 hover:bg-white/10 hover:text-white"
          aria-label={t.subCloseBtn}
        >
          <X className="h-4 w-4" />
        </button>
        <span className="text-[13px] font-bold tracking-wide text-white/75">{t.subGoPremium}</span>
        {step === 'pay' && decision === 'waiting' ? (
          <button
            onClick={handleChangePlan}
            className="flex h-9 items-center gap-1 rounded-full bg-white/5 px-2.5 text-[11px] font-semibold text-white/55 transition active:scale-95 hover:bg-white/10 hover:text-white"
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
                <div className="pointer-events-none absolute inset-[-10px] rounded-3xl bg-[#4A72C4]/20 blur-2xl" />
                <img
                  src="/assets/logo.png"
                  alt="NINT ANIME"
                  className="relative h-[68px] w-[68px] rounded-2xl ring-1 ring-[#4A72C4]/35"
                />
              </div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[#4A72C4]/25 bg-[#4A72C4]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#4A72C4]">
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
                const Icon = TIER_ICON[tr.key] ?? Zap;
                const selected = tr.key === selectedKey;
                const perMonth = tr.months > 1 ? (tr.price / tr.months).toFixed(2) : null;
                return (
                  <button
                    key={tr.key}
                    onClick={() => setSelectedKey(tr.key)}
                    className={`relative w-full overflow-hidden rounded-xl border px-3.5 pt-3.5 text-left transition-all active:scale-[0.99] ${
                      selected
                        ? 'border-[#4A72C4]/35 bg-[#4A72C4]/[0.045] pb-0 shadow-[0_6px_18px_-12px_rgba(74,114,196,0.45)]'
                        : 'border-white/[0.08] bg-white/[0.025] pb-3.5 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${
                          selected
                            ? 'bg-[#4A72C4]/15 ring-1 ring-[#4A72C4]/40'
                            : 'bg-white/[0.07]'
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${selected ? 'text-[#7FA3E8]' : 'text-white/60'}`} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{lang === 'km' ? tr.labelKm : tr.labelEn}</span>
                          {tr.badge === 'best' && (
                            <span className="rounded-md bg-[#4A72C4]/20 px-2 py-0.5 text-[10px] font-bold text-[#4A72C4]">
                              {t.subBestValue}
                            </span>
                          )}
                          {tr.badge === 'popular' && (
                            <span className="rounded-md bg-[#7A5CFF]/20 px-2 py-0.5 text-[10px] font-bold text-[#A392FF]">
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
                        <span className="absolute -left-[21px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#07070C]" />
                        <span className="absolute -right-[21px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-[#07070C]" />
                        <div className="border-t border-dashed border-[#4A72C4]/25" />
                        <div className="flex items-center justify-between py-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#7FA3E8]">
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
                <ShieldCheck className="h-3 w-3 text-[#35D399]" /> {t.subInstantUnlock}
              </span>
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-[#4A72C4]" /> {t.subDrawAfterPay}
              </span>
            </div>

            {error && (
              <p className="mt-4 rounded-xl border border-[#E6231F]/25 bg-[#E6231F]/10 px-3 py-2 text-xs text-[#FF8A85]">
                {error}
              </p>
            )}
          </>
        ) : decision === 'approved' ? (
          /* ---------------------------- PAID (RECEIPT) ---------------------------- */
          <div className="flex h-full flex-col justify-center gap-5 py-4">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#35D399]/12 ring-1 ring-[#35D399]/30">
                <Check className="h-8 w-8 text-[#35D399]" />
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
            <div className="rounded-3xl border border-white/[0.08] bg-white/[0.025] px-4 py-1">
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
                className="w-full rounded-full bg-gradient-to-r from-[#4A72C4] to-[#1F3A73] py-3.5 text-sm font-bold text-white shadow-[0_12px_34px_-12px_rgba(74,114,196,0.8)] transition active:scale-[0.98]"
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
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#E6231F]/10">
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
                setAbaCheckout(null);
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
            {/* Mode tabs — Auto (open the ABA app, auto-verified) vs
                Manual (save the QR, upload a receipt yourself). Both
                tabs point at the same live payment ticket underneath;
                this only changes which actions are shown. */}
            {decision === 'waiting' && (
              <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1.5">
                <button
                  type="button"
                  onClick={() => setPayMode('auto')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-bold transition active:scale-[0.98] ${
                    payMode === 'auto'
                      ? 'bg-gradient-to-r from-[#4A72C4] to-[#1F3A73] text-white shadow-[0_8px_20px_-8px_rgba(74,114,196,0.75)]'
                      : 'text-white/45 hover:text-white/70'
                  }`}
                >
                  <Zap className="h-4 w-4" /> {t.subAutoTab}
                </button>
                <button
                  type="button"
                  onClick={() => setPayMode('manual')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12px] font-bold transition active:scale-[0.98] ${
                    payMode === 'manual'
                      ? 'bg-[#7A5CFF] text-white shadow-[0_8px_20px_-8px_rgba(122,92,255,0.7)]'
                      : 'text-white/45 hover:text-white/70'
                  }`}
                >
                  <ImagePlus className="h-4 w-4" /> {t.subManualTab}
                </button>
              </div>
            )}

            {/* QR card — stays on screen the whole time; the viewer may
                not have paid yet when this first opens. Bigger amount +
                bigger QR so it reads clearly at a glance. */}
            {payTier && (
              <div className="relative overflow-hidden rounded-3xl border border-[#4A72C4]/20 bg-white/[0.03] p-4 text-center">
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
                    className="mx-auto mt-3.5 w-full max-w-[220px] rounded-2xl border border-white/10 bg-white p-2 shadow-[0_10px_34px_rgba(0,0,0,0.55)]"
                  />
                ) : (
                  <p className="mt-4 rounded-xl border border-[#4A72C4]/25 bg-[#4A72C4]/5 p-4 text-xs text-[#4A72C4]">
                    {t.subQrMissing}
                  </p>
                )}

                {payMode === 'auto' ? (
                  /* AUTO — countdown pill + one big "open the ABA app"
                      button. The admin's plan link (real gateway or the
                      static PayWay link) drives where this goes. */
                  <div className="mt-4 space-y-3">
                    <div className="mx-auto inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-4 py-2 text-[13px] font-semibold tabular-nums text-white/75">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4A72C4]" />
                      {t.subWaitingPayment} ({mmss})
                    </div>

                    {payLinkSrc ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openExternalLink(payLinkSrc)}
                          className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#4A72C4] to-[#1F3A73] py-4 text-sm font-extrabold text-white shadow-[0_14px_32px_-12px_rgba(74,114,196,0.9)] transition active:scale-[0.98]"
                        >
                          <Zap className="h-4 w-4" /> {t.subOpenAba}
                        </button>

                        {/* Escape hatch. Some Telegram builds still keep the
                            link inside their own browser, where the ABA app
                            can never be handed the universal link and the
                            page just spins. Copying it lets the viewer paste
                            it into Safari/Chrome, which does open ABA. */}
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await copyToClipboard(payLinkSrc);
                            if (ok) {
                              setPayLinkCopied(true);
                              window.setTimeout(() => setPayLinkCopied(false), 2200);
                            }
                          }}
                          className="flex w-full items-center justify-center gap-1.5 rounded-full border border-white/12 py-2.5 text-[11px] font-bold text-white/55 transition active:scale-[0.98] hover:border-white/30 hover:text-white/80"
                        >
                          {payLinkCopied ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#35D399]" /> {t.subPayLinkCopied}
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" /> {t.subCopyPayLink}
                            </>
                          )}
                        </button>
                      </>
                    ) : (
                      <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] text-white/40">
                        {t.subQrCaption}
                      </p>
                    )}

                    {payLinkSrc && (
                      <p className="text-[10px] leading-relaxed text-white/35">
                        {isRealGateway ? t.subGatewayVerifiedNote : t.subGatewayManualNote}
                      </p>
                    )}
                  </div>
                ) : (
                  /* MANUAL — save the QR, pick a receipt, review it, then
                     tap Pay to actually submit (that's the only moment
                     the admin gets pinged on this tab). */
                  <div className="mt-4 space-y-3 text-left">
                    {qrSrc && (
                      <a
                        href={qrSrc}
                        download={`nintanime-vip-${payTier.key}.png`}
                        className="flex w-full items-center justify-center gap-2 rounded-full border border-white/15 py-3 text-xs font-bold text-white/70 transition active:scale-[0.98] hover:border-white/35 hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5" /> {t.subSaveQr}
                      </a>
                    )}

                    <p className="text-[11px] leading-relaxed text-white/50">{t.subManualFlowNote}</p>

                    {proofSent ? (
                      <p className="flex items-center justify-center gap-1.5 rounded-2xl border border-[#35D399]/25 bg-[#35D399]/[0.07] py-3 text-xs font-semibold text-[#35D399]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.subCheckingPayment}
                      </p>
                    ) : proofFile ? (
                      <div className="space-y-2.5">
                        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20">
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
                          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#7A5CFF] py-3.5 text-sm font-extrabold text-white shadow-[0_10px_26px_-12px_rgba(122,92,255,0.75)] transition active:scale-[0.98] disabled:opacity-50"
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
                        className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-[#7A5CFF]/40 bg-[#7A5CFF]/[0.07] px-3.5 py-3 transition active:scale-[0.99] hover:border-[#7A5CFF]/70"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#7A5CFF]/20">
                          <ImagePlus className="h-4 w-4 text-[#A392FF]" />
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
                )}
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-[#E6231F]/25 bg-[#E6231F]/10 px-3 py-2 text-xs text-[#FF8A85]">
                {error}
              </p>
            )}

            <button
              onClick={onClose}
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
          className="relative z-10 shrink-0 border-t border-white/[0.08] bg-[#07070C]/95 px-4 pt-3 backdrop-blur"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-[11px] text-white/45">{t.subTotalDue}</span>
            <span className="text-xl font-extrabold text-white">{tier ? `$${tier.price}` : '—'}</span>
          </div>
          <button
            onClick={handleJoinVip}
            disabled={!tier || submitting}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#4A72C4] to-[#1F3A73] py-4 text-sm font-extrabold text-white shadow-[0_14px_36px_-14px_rgba(74,114,196,0.95)] transition active:scale-[0.98] disabled:opacity-40"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
            {submitting ? t.subSending : t.subJoinVip}
          </button>
          <p className="mt-2 flex items-center justify-center gap-1 text-[10px] text-white/28">
            <Send className="h-2.5 w-2.5" /> {t.subJoinVipNote}
          </p>
        </footer>
      )}
    </div>
  );
}
