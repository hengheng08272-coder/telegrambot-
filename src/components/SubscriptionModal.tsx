import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Crown,
  ImagePlus,
  Loader2,
  RefreshCw,
  MessageCircle,
  Send,
  Wallet,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { openExternalLink, getSupportLink } from '@/lib/telegram';
import {
  decodeKhqrFromImage,
  readKhqrMerchant,
  readKhqrAmount,
} from '@/lib/khqr';
import {
  fetchBakongConfig,
  generateKhqr,
  renderQrDataUrl,
  type BakongConfig,
} from '@/lib/bakong';
import { compressReceipt } from '@/lib/imageCompress';
import KhqrCard from '@/components/KhqrCard';
import BankChoice from '@/components/BankChoice';
import { formatAmount } from '@/lib/format';
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
  getKhqrStrings,
  checkBakongPayment,
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
  /**
   * Raised while a receipt is sent and still awaiting a decision, so the
   * app can put a small "verifying" pill in front of the viewer instead
   * of holding them on this screen. Waiting is not an activity — see
   * App.tsx, which reopens this sheet from that pill.
   */
  onVerifyingChange?: (verifying: boolean) => void;
}

type Step = 'pick' | 'pay';

// Small brand mark carried at the top of every checkout screen — in the
// sheet, and on the standalone Safari page. Same logo, same size, so a
// viewer handed off to a browser can see they are still inside the same
// product and not on some payment site.
// The NintPlex mark. The old NINT ANIME logo is left in place as a file
// so nothing that still points at it 404s, but every screen the viewer
// actually meets now carries the new one.
const LOGO_SRC = '/assets/images/nintplex-logo.png';

// How long one payment ticket stays open while the ABA auto-confirm
// webhook listens for a matching bank notification. When this hits zero
// with (a) no real ABA match and (b) no receipt photo attached, the
// ticket is auto-rejected server-side and a fresh one is opened in its
// place — see the recycle effect below.
const WAIT_WINDOW_SECONDS = 180;

// The countdown stops being background information at this point and
// becomes something worth asking about — see the "still there?" prompt.
const NUDGE_AT_SECONDS = 30;

// Khmer digits, so the number on the ticket stub is written the same way
// the rest of the sheet writes numbers. Latin digits stay Latin for the
// English UI, and prices stay Latin everywhere — that is how they are
// printed on the bank's own screens.
const KH_DIGITS = ['០', '១', '២', '៣', '៤', '៥', '៦', '៧', '៨', '៩'];
function toKhmerDigits(value: number): string {
  return String(value)
    .split('')
    .map((ch) => KH_DIGITS[Number(ch)] ?? ch)
    .join('');
}

export default function SubscriptionModal({
  onClose,
  onSubmitted,
  onApproved,
  onGoSpin,
  onVerifyingChange,
}: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const [step, setStep] = useState<Step>('pick');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PaymentSubmission | null>(null);
  const [checkingPending, setCheckingPending] = useState(true);
  // Plans arrive a beat after the sheet opens; until they do the picker
  // shows skeleton rows rather than an empty screen with a dead CTA.
  const [tiersLoading, setTiersLoading] = useState(true);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  // KHQR payload read back out of the tier's QR image -> lets the primary
  // button jump straight into ABA instead of via PayWay's web page.
  const [khqrString, setKhqrString] = useState<string | null>(null);
  // Payloads stored at upload time — preferred over decoding the image.
  const [storedKhqr, setStoredKhqr] = useState<Record<string, string>>({});
  // Bakong KHQR generated for THIS payment attempt, under the owner's own
  // merchant name, with the tier's price and the ticket id baked in. Null
  // whenever the owner hasn't configured Bakong, in which case everything
  // below falls back to the QR image they uploaded.
  const [bakongConfig, setBakongConfig] = useState<BakongConfig | null>(null);
  // Which bank's QR is on screen. Only ever offered when the owner has
  // pasted two, which they do because the banks disagree about what a
  // payload may say — see BakongConfig.khqrTemplateAlt.
  const [bank, setBank] = useState<'primary' | 'alt'>('primary');
  const [liveKhqr, setLiveKhqr] = useState<{ payload: string; md5: string; image: string } | null>(
    null,
  );
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
  // A big screenshot is resized before it is staged; on a slow phone that
  // is a visible beat, so it gets its own state rather than a frozen tap.
  const [preparingProof, setPreparingProof] = useState(false);
  // Set when the ABA hand-off was tapped and this page was still in the
  // foreground afterwards — i.e. nothing opened. Without this the tap
  // silently does nothing and the viewer has no idea whether to wait,
  // retry, or scan the QR instead.
  // Set the moment the viewer taps "Open ABA Mobile" — from then on the
  // primary action on the Auto tab switches from "go open the app" to
  // "upload the receipt", since they've already left once and the next
  // thing they do is come back with a screenshot. Reset on Change Plan /
  // a fresh ticket so a new payment starts on the open-app button again.
  // The sheet opened straight onto a ticket that was already running —
  // Telegram reloads the Mini App every time it is opened, so this is
  // the ordinary case for someone coming back from their bank. They may
  // well have paid already, so the receipt box has to be there even
  // though this session never saw the hand-off happen.
  // True from the moment the viewer comes back to this sheet after being
  // handed off — the copy on the upload block changes from "optional"
  // to "you paid, send the receipt", which is the step people forget.
  const [returnedFromPay, setReturnedFromPay] = useState(false);
  const [highlightUpload, setHighlightUpload] = useState(false);
  // Guards the header X (and Telegram/system back) while a ticket is
  // actively open — one accidental tap should never silently drop a
  // payment in progress, so it asks first instead of closing right away.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  // The KHQR route draws its code right in the sheet. Tapping it blows
  // it up to fill the screen — that is the moment someone screenshots
  // it, and a QR at 150px with a phone's own UI around it is not what
  // another bank's scanner wants to read.
  const [qrZoom, setQrZoom] = useState(false);
  const notifiedApprovedRef = useRef(false);
  const recyclingRef = useRef(false);
  const uploadBlockRef = useRef<HTMLDivElement | null>(null);
  // Latest staged-preview object URL, so unmount can revoke it — the
  // component is unmounted by its parent the moment the sheet closes,
  // which is exactly when a staged-but-unsent photo leaks otherwise.
  const proofPreviewRef = useRef<string | null>(null);
  proofPreviewRef.current = proofPreviewUrl;
  useEffect(
    () => () => {
      if (proofPreviewRef.current) URL.revokeObjectURL(proofPreviewRef.current);
    },
    [],
  );

  // Loaded from app_settings, not hardcoded — see getHiddenTierKeys().
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const visibleTiers = useMemo(
    () => tiers.filter((tr) => !hiddenKeys.has(tr.key)),
    [tiers, hiddenKeys],
  );

  // The dearest month on offer, used as the "before" price every other
  // plan's saving is measured against. Derived from what is actually
  // offered rather than pinned to the 1-month key, so hiding or
  // re-pricing a plan can never leave a stale "save 40%" on screen.
  const baselinePerMonth = useMemo(() => {
    const rates = visibleTiers.map((tr) => tr.price / Math.max(1, tr.months));
    return rates.length ? Math.max(...rates) : 0;
  }, [visibleTiers]);

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
        if (elapsedSec >= WAIT_WINDOW_SECONDS) {
          // Long gone. Close it out and open on the plan picker, rather
          // than resuming a dead window just to shut it a second later.
          cancelPaymentSubmission(p.id);
          setPending(null);
          return;
        }
        setSecondsLeft(WAIT_WINDOW_SECONDS - elapsedSec);
        setStep('pay');
      }
    });
    getQrCodes().then(setQrImages);
    getKhqrStrings().then(setStoredKhqr);
    // Both are needed before a plan can be preselected, so they resolve
    // together rather than racing each other into setState.
    Promise.all([getEffectivePricingTiers(), getHiddenTierKeys()]).then(([rows, hidden]) => {
      setTiers(rows);
      setHiddenKeys(hidden);
      setTiersLoading(false);
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

    // Bakong is asked every fourth tick (~12s) rather than every one. The
    // bank's answer changes only when a real payment lands, so polling it
    // at the same rate as our own table would burn the Open API's rate
    // limit to learn nothing.
    let tick = 0;
    const pollInterval = window.setInterval(async () => {
      if (recyclingRef.current) return;
      const status = await checkSubmissionStatus(pending.id);
      if (recyclingRef.current) return;
      if (status === 'approved') return setDecision('approved');
      if (status === 'rejected') return setDecision('rejected');

      // Nothing decided yet — ask the bank directly about this ticket's
      // own QR. bakong-verify writes the same status column, so the tick
      // above picks the result up either way.
      tick += 1;
      if (liveKhqr && tick % 4 === 0) {
        const outcome = await checkBakongPayment(pending.id, liveKhqr.md5);
        if (!recyclingRef.current && outcome === 'granted') setDecision('approved');
      }
    }, 3000);

    // The clock stops the moment a receipt is on its way to the admin.
    // A receipt that has been sent is a payment that has been made, and
    // running it out from under the viewer would throw away the proof
    // they just took the trouble to send.
    const countdown = proofSent
      ? null
      : window.setInterval(() => {
          setSecondsLeft((s) => Math.max(0, s - 1));
        }, 1000);

    return () => {
      window.clearInterval(pollInterval);
      if (countdown !== null) window.clearInterval(countdown);
    };
  }, [step, pending, decision, liveKhqr, proofSent]);

  // The 3-minute window ran out with no ABA match and no receipt photo.
  // The ticket is closed out server-side (so the ABA matcher can never
  // attach a later, unrelated payment to an abandoned one) and the sheet
  // simply closes: the viewer lands back where they started and picks a
  // plan again. Opening a replacement ticket behind their back, which is
  // what used to happen, kept a live payment window running for someone
  // who had already walked away.
  useEffect(() => {
    if (step !== 'pay' || !pending || decision !== 'waiting') return;
    if (secondsLeft > 0 || proofSent || attachingProof || recyclingRef.current) return;

    recyclingRef.current = true;
    (async () => {
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

      // Still open because the expire helper isn't installed: cancel it
      // by the ordinary route instead, or the next time this sheet opens
      // it would resume a ticket whose clock ran out and close itself
      // again straight away.
      if (status === 'pending') await cancelPaymentSubmission(pending.id);

      recyclingRef.current = false;
      onClose();
    })();
  }, [secondsLeft, step, pending, decision, proofSent, attachingProof, onClose]);

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

  // Tell the app whether there is a receipt in flight, so it can offer
  // the "verifying" pill instead of trapping the viewer here.
  useEffect(() => {
    onVerifyingChange?.(proofSent && decision === 'waiting');
  }, [proofSent, decision, onVerifyingChange]);

  const tier = visibleTiers.find((tr) => tr.key === selectedKey) ?? null;
  const payTier = tiers.find((tr) => tr.key === (pending?.tier ?? selectedKey)) ?? null;
  // Only ever the QR this owner uploaded. There used to be a bundled
  // fallback image here, which meant a tier with no QR of its own quietly
  // showed somebody else's KHQR — real money would have left for an
  // account this app doesn't own, and auto-confirm could never match it,
  // so the payer lost the money AND got no VIP. With no QR configured the
  // viewer now gets the "contact the admin" message instead (subQrMissing).
  const qrSrc = liveKhqr?.image ?? (payTier ? qrImages[payTier.key] ?? null : null);
  // Prefer the payload saved when the admin uploaded the QR; only fall
  // back to decoding the image in the browser when that is missing (old
  // uploads, or before the migration was run).
  const effectiveKhqr = liveKhqr?.payload ?? (payTier ? storedKhqr[payTier.key] : null) ?? khqrString;
  // Read back out of the payload that is actually on screen, so it can
  // never drift from what the payer's bank will show them.
  const payeeName = readKhqrMerchant(effectiveKhqr);

  // The amount the bank will actually charge, read out of the QR itself.
  // If it disagrees with the plan's price, every route to paying is shut
  // off below: losing one sale is far cheaper than taking the wrong
  // amount off someone, which leaves them out of pocket AND without VIP
  // (auto-confirm matches on the amount, so a mismatched payment can
  // never unlock anything by itself).
  const qrAmount = readKhqrAmount(effectiveKhqr);
  const amountMismatch =
    !!payTier && qrAmount !== null && Math.abs(qrAmount - payTier.price) > 0.005;

  // Is the KHQR ticket itself on screen? It prints the merchant name
  // and the amount already, so whatever the pass says above it is a
  // second copy of the same figure — see the pay step below, which
  // drops its own amount line whenever this is true.
  const ticketShowing =
    !amountMismatch && !proofSent && !!liveKhqr;

  // The owner's Bakong details, read once when the sheet opens.
  useEffect(() => {
    let cancelled = false;
    fetchBakongConfig().then((cfg) => {
      if (!cancelled) setBakongConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // One freshly-generated KHQR per payment attempt: the owner's merchant
  // name, the tier's exact price, the ticket id as the bill number and an
  // expiry matching the countdown. Regenerating when the ticket or tier
  // changes is what keeps a QR tied to exactly one attempt — a viewer who
  // lets the window lapse and starts again gets a new one, so a late
  // payment can never be matched against the wrong ticket.
  useEffect(() => {
    let cancelled = false;
    if (!bakongConfig || !payTier) {
      setLiveKhqr(null);
      return;
    }
    (async () => {
      const generated = await generateKhqr({
        config: bakongConfig,
        amount: payTier.price,
        bank,
        billNumber: pending ? pending.id.slice(0, 8).toUpperCase() : null,
        storeLabel: lang === 'km' ? payTier.labelKm : payTier.labelEn,
        expiresInMs: WAIT_WINDOW_SECONDS * 1000,
      });
      if (cancelled || !generated) {
        if (!cancelled) setLiveKhqr(null);
        return;
      }
      const image = await renderQrDataUrl(generated.payload);
      if (cancelled) return;
      // Without an image there is nothing to show or scan, so this falls
      // back to the uploaded QR rather than half-applying.
      setLiveKhqr(image ? { payload: generated.payload, md5: generated.md5, image } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [bakongConfig, payTier, pending, lang, bank]);

  // Decode the tier's QR image once so the primary button can jump
  // straight into ABA. Cancelled on tier change so a slow decode can't
  // apply a stale plan's payload to the newly-selected one.
  useEffect(() => {
    let cancelled = false;
    setKhqrString(null);
    // Nothing to decode when the payload is already stored.
    if (payTier && storedKhqr[payTier.key]) return;
    if (!qrSrc) return;
    decodeKhqrFromImage(qrSrc).then((value) => {
      if (!cancelled) setKhqrString(value);
    });
    return () => {
      cancelled = true;
    };
  }, [qrSrc, payTier, storedKhqr]);

  // Hands the checkout page to the system browser the moment this
  // ticket's KHQR exists — the "2-in-1" step: one page carrying both the
  // QR and a deeplink that actually opens ABA, because inside Telegram's
  // WebView `abamobilebank://` is swallowed and nothing this app renders
  // can open the bank itself.
  //
  // The payload is not ready when the method is picked (it is generated
  // against the ticket id, one render later), which is why this waits on
  // payPageUrl rather than firing from the tap. Telegram's openLink is a
  // native bridge call, not window.open, so opening it a beat later is
  // still honoured — that is only true inside Telegram, which is exactly
  // where this is armed.
  // Coming back from the bank is where this flow used to lose people:
  // Safari hands the viewer back to a screen that looks exactly like the
  // one they left, with the last step — send the receipt — somewhere
  // below the fold. So the moment this page is frontmost again, the
  // upload block is scrolled to and lit for two seconds, and its wording
  // changes from "optional" to "you paid, now send it".
  useEffect(() => {
    if (step !== 'pay' || proofSent || decision !== 'waiting') return;

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setReturnedFromPay(true);
      setHighlightUpload(true);
      window.setTimeout(() => {
        uploadBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
      window.setTimeout(() => setHighlightUpload(false), 2200);
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [step, proofSent, decision]);

  // Everything a fresh payment attempt has to forget. Every exit from an
  // open ticket (change plan, change method, retry after a rejection)
  // runs through this — the retry path used to reset only some of it and
  // carried `handedOff` over, which is why a second attempt opened on the
  // "upload your receipt" step for a payment that had never been started.
  const resetTicketState = () => {
    setPending(null);
    setDecision('waiting');
    setSecondsLeft(WAIT_WINDOW_SECONDS);
    setReceipt(null);
    setProofSent(false);
    setAttachingProof(false);
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofFile(null);
    setProofPreviewUrl(null);
    setShowExitConfirm(false);
    setReturnedFromPay(false);
    setHighlightUpload(false);
    setError('');
    notifiedApprovedRef.current = false;
  };

  // Picking a plan now only advances to the payment-method sheet — the
  // ticket itself isn't opened until the viewer actually picks ABA or
  // Other Bank there, so nothing is submitted for a plan they might
  // still change their mind about.
  const handlePickPlan = () => {
    if (!tier) return;
    void openPaymentTicket();
  };

  /**
   * Opens the payment ticket and goes straight to the code.
   *
   * There used to be a method step here — "ABA" beside "another bank's
   * app" — and it is gone because the choice it offered was not real.
   * The money is collected on one KHQR, and a KHQR is one standard:
   * every member bank's app reads the same code. The ABA branch existed
   * to hand off to `abamobilebank://`, which PayWay refuses for a code
   * it did not issue, so on this account that route could only ever end
   * in "Invalid Qr Merchant Data". A screen asking people to choose
   * between a route that works and a route that cannot is a screen that
   * loses payments.
   *
   * The admin is not messaged at this point — only once there is
   * something for them to act on: a bank notification matching this
   * ticket, or the viewer submitting a receipt photo.
   */
  const openPaymentTicket = async () => {
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
    resetTicketState();
    recyclingRef.current = false;
    const fresh = await getPendingSubmission();
    if (fresh) setPending(fresh);
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
  // review — nothing is uploaded and the admin isn't messaged yet. The
  // photo is shrunk first when it is a multi-megabyte screenshot, which
  // is what a modern phone hands over.
  const handlePickProof = async (file: File) => {
    setError('');
    setPreparingProof(true);
    const ready = await compressReceipt(file);
    setPreparingProof(false);
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofFile(ready);
    setProofPreviewUrl(URL.createObjectURL(ready));
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

  // Receipts are usually already in the clipboard: people screenshot
  // inside ABA, and iOS offers Paste before it offers the photo library.
  // Accepting a paste anywhere on the pay screen saves the whole trip
  // through the picker.
  const canStageProof =
    step === 'pay' && !!pending && !proofSent && !attachingProof && decision === 'waiting';
  useEffect(() => {
    if (!canStageProof) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        handlePickProof(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // handlePickProof only reads state it also sets; re-binding on every
    // preview change would drop a paste mid-gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canStageProof]);

  // "Change Plan" — the viewer decided they want a different tier mid-
  // ticket. Cancels the open ticket right away (no 150s floor, unlike the
  // background auto-expire) and drops back to the picker with a clean
  // slate. Guards against the recycle effect firing on the ticket we're
  // about to close out from under it.
  const handleChangePlan = async () => {
    recyclingRef.current = true;
    if (pending) await cancelPaymentSubmission(pending.id);
    setStep('pick');
    resetTicketState();
    recyclingRef.current = false;
  };

  // Confirmed exit: the ticket goes with them. Leaving it open would
  // keep a payment window alive for someone who is no longer looking at
  // it, and the next visit should start from a clean plan choice.
  const handleExitAndDrop = async () => {
    recyclingRef.current = true;
    setShowExitConfirm(false);
    if (pending) await cancelPaymentSubmission(pending.id);
    onClose();
  };

  // Header X (and the confirm sheet's own "Exit"): while a ticket is
  // open and still waiting, ask first instead of dropping straight out —
  // that's the one moment a stray tap costs the viewer real progress.
  // Once the receipt is sent there is nothing left to lose by leaving,
  // so it closes immediately and the app carries the waiting for them.
  const handleRequestClose = () => {
    if (step === 'pay' && decision === 'waiting' && !proofSent && !showExitConfirm) {
      setShowExitConfirm(true);
      return;
    }
    onClose();
  };

  // The plain "scan this" state: nothing sent, nothing wrong, nothing
  // pending. It is the only state on this step that can be trimmed —
  // the QR says "scan me" by being a QR, so the icon, the sentence under
  // the title and the plan restatement are all saying it a second time,
  // and between them they push the countdown and the upload box off the
  // bottom of a phone. Every other state keeps its full explanation.
  const payCompact = !proofSent && !amountMismatch;

  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const waitPct = Math.max(0, Math.min(100, (secondsLeft / WAIT_WINDOW_SECONDS) * 100));
  const ticketRef = pending ? pending.id.slice(0, 8).toUpperCase() : '—';
  const planLabel = (tr: PricingTier | null) =>
    tr ? (lang === 'km' ? tr.labelKm : tr.labelEn) : '—';
  const localNum = (value: number) => (lang === 'km' ? toKhmerDigits(value) : String(value));
  const supportLink = getSupportLink();

  // The last half-minute of the window, with nothing sent yet: rather
  // than resetting the screen out from under someone who is still typing
  // their PIN in ABA, ask, and let them buy another three minutes.
  const showKeepWaiting =
    decision === 'waiting' && !proofSent && secondsLeft > 0 && secondsLeft <= NUDGE_AT_SECONDS;

  // Shared receipt-upload widget: pick a screenshot, review it, tap send
  // to actually submit (that's the only moment the admin gets pinged).
  const receiptUploadUi = proofFile ? (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-[var(--co-r-btn)] border border-[color:var(--co-line)] bg-black/30">
        {proofPreviewUrl && (
          <img src={proofPreviewUrl} alt="" className="max-h-52 w-full object-contain" />
        )}
        <button
          type="button"
          onClick={handleDiscardPickedProof}
          disabled={attachingProof}
          aria-label={t.subChangePhoto}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white/85 transition active:scale-90 hover:bg-black/85 disabled:opacity-40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={handleConfirmManualPay}
        disabled={attachingProof}
        className="co-btn co-btn-primary py-4 text-[15px]"
      >
        {attachingProof ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {attachingProof ? t.subUploadingProof : t.subSendReceipt}
      </button>
    </div>
  ) : (
    <label
      className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[var(--co-r-btn)] border border-dashed px-4 py-3.5 transition active:scale-[0.99] ${
        returnedFromPay
          ? 'border-[color:var(--co-brand-ring)] bg-[color:var(--co-brand-soft)]'
          : 'border-[color:var(--co-line-strong)] bg-white/[0.03]'
      }`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--co-r-chip)] bg-white/[0.06]">
        {preparingProof ? (
          <Loader2 className="h-4 w-4 animate-spin text-[color:var(--co-text-muted)]" />
        ) : (
          <ImagePlus
            className={`h-4 w-4 ${returnedFromPay ? 'text-[color:var(--co-brand)]' : 'text-[color:var(--co-text-muted)]'}`}
          />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-[color:var(--co-text)]">
          {returnedFromPay ? t.subPaidSendReceipt : t.subUploadReceiptCta}
        </span>
        <span className="block text-[11px] text-[color:var(--co-text-dim)]">
          {preparingProof ? t.subPreparingPhoto : t.subPasteHint}
        </span>
      </span>
      {/* capture is deliberately absent: `accept="image/*"` alone lets
          iOS offer Camera, Photo Library and Files, which is what a
          receipt actually needs. */}
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
  );

  const amberNote = (title: string, body: ReactNode) => (
    <div className="rounded-[var(--co-r-card)] border border-[color:var(--co-amber-line)] bg-[color:var(--co-amber-soft)] px-4 py-3.5">
      <p className="flex items-center gap-2 text-[13px] font-bold text-[color:var(--co-amber)]">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {title}
      </p>
      <div className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--co-text-muted)]">{body}</div>
    </div>
  );

  const contactAdminLink = supportLink ? (
    <button
      type="button"
      onClick={() => openExternalLink(supportLink)}
      className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-[var(--co-r-btn)] border border-[color:var(--co-line)] bg-white/[0.03] px-4 text-[13px] font-bold text-[color:var(--co-text-muted)] transition hover:text-[color:var(--co-text)]"
    >
      <MessageCircle className="h-3.5 w-3.5" />
      {t.subContactAdminNow}
    </button>
  ) : null;

  return (
    <div className="co-scope fixed inset-0 z-[95] flex flex-col">
      {/* Header — the logo rides along at 32px on every step, and on the
          Safari page too, so a viewer handed off to a browser can see
          they are still inside the same product. */}
      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between px-4">
        <button
          onClick={handleRequestClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.05] text-[color:var(--co-text-muted)] transition active:scale-90 hover:bg-white/10 hover:text-[color:var(--co-text)]"
          aria-label={t.subCloseBtn}
        >
          <X className="h-4 w-4" />
        </button>
        <span className="flex items-center gap-2">
          <img src={LOGO_SRC} alt="" className="h-8 w-8 shrink-0 object-contain" />
          {/* The wordmark, set to carry the same weight as the mark beside
              it: the display face at the logo's own cap height, with PLEX
              in the brand red. Plain 13px body text next to a 32px logo
              read as a caption for the picture rather than as the name of
              the product. */}
          <span
            className="text-[20px] leading-none text-[color:var(--co-text)]"
            style={{ fontFamily: 'var(--co-font-display)', letterSpacing: '0.02em' }}
          >
            NINT<span style={{ color: '#E6231F' }}>PLEX</span>
          </span>
        </span>
        <span className="h-10 w-10" />
      </header>


      {/* Tapped QR: as big as the screen allows, on white, with nothing
          else on it — a clean thing to screenshot and hand to a bank
          app. Tapping anywhere puts it back. */}
      {qrZoom && qrSrc && (
        <button
          type="button"
          onClick={() => setQrZoom(false)}
          aria-label={t.subClose}
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/90 px-6"
        >
          <span className="rounded-[18px] bg-white p-4">
            <img
              src={qrSrc}
              alt="KHQR"
              className="block h-auto w-[min(74vw,340px)] object-contain"
            />
          </span>
          <span className="text-center text-[13px] leading-relaxed text-white/70">
            {t.subQrZoomHint}
          </span>
        </button>
      )}

      {/* Exit-confirm sheet — the header X (and the hardware/Telegram back
          gesture, which also routes here) land on this instead of closing
          straight away whenever a ticket is open and nothing has been
          sent yet. Once a receipt is on its way this never appears: the
          app carries the waiting instead (see the verifying pill). */}
      {showExitConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="co-card w-full max-w-[19rem] p-5 text-center shadow-[var(--co-shadow-card)]">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--co-amber-soft)]">
              <AlertTriangle className="h-5 w-5 text-[color:var(--co-amber)]" />
            </div>
            <p className="text-[15px] font-bold text-[color:var(--co-text)]">{t.subExitConfirmTitle}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--co-text-muted)]">
              {t.subExitConfirmDesc}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="co-btn co-btn-primary py-3.5 text-[15px]"
              >
                {t.subExitConfirmContinue}
              </button>
              <button
                onClick={handleExitAndDrop}
                className="co-btn co-btn-ghost py-3.5 text-[15px]"
              >
                {t.subExitConfirmExit}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="relative z-10 flex-1 overflow-y-auto px-4 pb-6">
        {checkingPending ? (
          /* ---------------------------- LOADING ---------------------------- */
          <div className="space-y-3 pt-1" aria-busy="true" aria-label={t.subLoadingPlans}>
            <div className="co-skeleton skeleton-shimmer mx-auto h-7 w-44" />
            <div className="co-skeleton skeleton-shimmer h-16" />
            <div className="co-skeleton skeleton-shimmer h-[70px]" />
            <div className="co-skeleton skeleton-shimmer h-[70px]" />
            <div className="co-skeleton skeleton-shimmer h-[70px]" />
          </div>
        ) : step === 'pick' ? (
          /* ---------------------------- PLAN PICKER ---------------------------- */
          <div key="pick" className="co-enter">
            <div className="flex flex-col items-center pb-5 pt-1 text-center">
              <span
                className="mb-1.5 text-[11px] tracking-[0.3em]"
                style={{ fontFamily: 'var(--co-font-display)', color: 'var(--co-brand)' }}
              >
                {t.subAccessPass}
              </span>
              <h2
                className="text-[26px] leading-tight text-[color:var(--co-text)]"
                style={{ fontFamily: 'var(--co-font-display)', letterSpacing: '0.015em' }}
              >
                {t.subChoosePlan}
              </h2>
              <p className="mt-1.5 text-[11px] text-[color:var(--co-text-dim)]">{t.subTagline}</p>
            </div>

            {/* Benefits, once, above the list — so the plan rows can be
                pure price comparison instead of each repeating the pitch. */}
            <div className="mb-4 grid grid-cols-3 gap-2">
              {(
                [
                  [ShieldCheck, t.subInstantUnlock],
                  [BadgeCheck, t.subFullAccess],
                  [Sparkles, t.subDrawAfterPay],
                ] as [typeof ShieldCheck, string][]
              ).map(([Icon, label]) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-1.5 rounded-[var(--co-r-chip)] border border-[color:var(--co-line-soft)] bg-white/[0.02] px-2 py-2.5 text-center"
                >
                  <Icon className="h-3.5 w-3.5 text-[color:var(--co-green)]" />
                  <span className="text-[11px] leading-tight text-[color:var(--co-text-dim)]">
                    {label}
                  </span>
                </div>
              ))}
            </div>

            {tiersLoading ? (
              <div className="space-y-3" aria-busy="true" aria-label={t.subLoadingPlans}>
                <div className="co-skeleton skeleton-shimmer h-[70px]" />
                <div className="co-skeleton skeleton-shimmer h-[70px]" />
                <div className="co-skeleton skeleton-shimmer h-[70px]" />
              </div>
            ) : visibleTiers.length === 0 ? (
              amberNote(t.subNoPlansTitle, <>{t.subNoPlansDesc}{contactAdminLink}</>)
            ) : (
              <div className="space-y-3">
                {visibleTiers.map((tr) => {
                  const selected = tr.key === selectedKey;
                  const perMonth = (tr.price / Math.max(1, tr.months)).toFixed(2);
                  // Computed, never typed by hand: re-pricing a plan can
                  // not leave a stale "save 38%" behind.
                  const savePct =
                    baselinePerMonth > 0
                      ? Math.round((1 - tr.price / tr.months / baselinePerMonth) * 100)
                      : 0;
                  return (
                    <button
                      key={tr.key}
                      onClick={() => setSelectedKey(tr.key)}
                      aria-pressed={selected}
                      aria-label={`${planLabel(tr)} — $${tr.price}`}
                      className={`co-ticket w-full text-left ${selected ? 'co-ticket-selected' : ''}`}
                    >
                      {/* The plan's tab, hung off the ticket's top edge.
                          It used to be an inline chip wedged between the
                          pitch and the price, which is the row already
                          carrying the most to read. */}
                      {tr.badge === 'best' && <span className="co-tab co-tab-gold">{t.subBestValue}</span>}
                      {tr.badge === 'popular' && <span className="co-tab">{t.subPopular}</span>}
                      {/* The stub: how long the pass runs, in the numerals
                          the viewer reads prices in. */}
                      <span className="co-ticket-stub">
                        <span
                          className="leading-none"
                          style={{
                            fontFamily: 'var(--co-font-display)',
                            fontSize: '22px',
                            color: selected ? 'var(--co-brand)' : 'var(--co-text)',
                          }}
                        >
                          {localNum(tr.months)}
                        </span>
                        <span className="co-untrack-km text-[11px] tracking-[0.16em] text-[color:var(--co-text-dim)]">
                          {t.subMonthsUnit}
                        </span>
                      </span>
                      <span className="co-ticket-spine" aria-hidden="true" />

                      <span className="flex min-w-0 flex-1 items-center gap-2 px-3.5 py-3">
                        <span className="min-w-0 flex-1">
                          {/* The admin's own pitch leads — the duration is
                              already on the stub, so repeating the plan
                              name here would say it twice. */}
                          <span className="block truncate text-[13px] font-bold text-[color:var(--co-text)]">
                            {tr.pitchKm || planLabel(tr)}
                          </span>
                          {/* Always the per-month rate, even on the
                              single-month plan: it is the number every
                              other row is compared against, and the plan
                              name is already on the stub beside it. */}
                          <span className="mt-0.5 block truncate text-[11px] tabular-nums text-[color:var(--co-text-dim)]">
                            ${perMonth}
                            {t.subPerMonth}
                            {savePct >= 5 && (
                              <span className="ml-1.5 font-bold" style={{ color: 'var(--co-green)' }}>
                                · {t.subSaveBadge} {savePct}%
                              </span>
                            )}
                          </span>
                        </span>

                        <span
                          className="shrink-0 leading-none tabular-nums"
                          style={{ fontFamily: 'var(--co-font-display)', fontSize: '22px' }}
                        >
                          ${tr.price}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* What the membership is, spelled out once under the price
                comparison. The three chips above say it in two words
                each; this is the sentence version, for the viewer who is
                still deciding rather than still choosing. */}
            {!tiersLoading && visibleTiers.length > 0 && (
              <div className="mt-5 border-t border-[color:var(--co-line-soft)] pt-4">
                <p className="co-label mb-2.5 text-[color:var(--co-text-faint)]">
                  {t.subIncludesTitle}
                </p>
                <ul className="space-y-2">
                  {[t.subIncl1, t.subIncl2, t.subIncl3].map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <Check
                        className="mt-[2px] h-3.5 w-3.5 shrink-0"
                        style={{ color: 'var(--co-green)' }}
                      />
                      <span className="text-[13px] leading-snug text-[color:var(--co-text-dim)]">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <div className="mt-4">{amberNote(t.subQrGenericError, error)}</div>}
          </div>
        ) : decision === 'approved' ? (
          /* ---------------------------- PAID (RECEIPT) ---------------------------- */
          <div key="paid" className="co-enter mx-auto flex h-full max-w-[21rem] flex-col justify-center gap-5 py-4">
            <div className="flex flex-col items-center text-center">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-full"
                style={{
                  backgroundColor: 'var(--co-green-soft)',
                  boxShadow: 'inset 0 0 0 1px var(--co-green-line)',
                }}
              >
                <Check className="h-8 w-8" style={{ color: 'var(--co-green)' }} />
              </div>
              <p className="mt-4 text-[18px] font-bold text-[color:var(--co-text)]">
                {t.subPaySuccessTitle}
              </p>
              <p className="mt-1.5 max-w-[19rem] text-[13px] leading-relaxed text-[color:var(--co-text-muted)]">
                {t.subPaySuccessDesc}
              </p>
            </div>

            {/* The pass, stamped. Same object as the one they were
                waiting on a minute ago — what they bought, what it cost,
                the bank's own reference (ABA's "Trx. ID") and when it
                runs out. */}
            <div className="co-pass">
              <div className="co-pass-band">
                <span
                  className="text-[13px] tracking-[0.22em]"
                  style={{ fontFamily: 'var(--co-font-display)' }}
                >
                  {t.subVipPass}
                </span>
                <span
                  className="co-untrack-km rounded-[3px] border border-white/45 px-1.5 py-0.5 text-[11px] tracking-[0.16em]"
                  style={{ fontFamily: 'var(--co-font-display)', transform: 'rotate(-4deg)' }}
                >
                  {t.subPaidStamp}
                </span>
              </div>
              <div className="px-4 py-1">
              {(
                [
                  [t.subReceiptPlan, planLabel(payTier)],
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
                  className="flex items-center justify-between gap-3 border-b border-[color:var(--co-line-soft)] py-3 last:border-b-0"
                >
                  <span className="shrink-0 text-[11px] text-[color:var(--co-text-dim)]">
                    {label}
                  </span>
                  <span className="truncate text-[13px] font-semibold tabular-nums text-[color:var(--co-text)]">
                    {value}
                  </span>
                </div>
              ))}
              </div>
            </div>

            <div className="space-y-2.5">
              <button onClick={onGoSpin} className="co-btn co-btn-primary py-4 text-[15px]">
                <Sparkles className="h-4 w-4" />
                {t.subGoDraw}
              </button>
              <button onClick={onClose} className="co-btn co-btn-ghost py-4 text-[15px]">
                {t.subStartWatching}
              </button>
            </div>
          </div>
        ) : decision === 'rejected' ? (
          /* ---------------------------- REJECTED ---------------------------- */
          <div key="rejected" className="co-enter mx-auto flex h-full max-w-[21rem] flex-col items-center justify-center gap-5 text-center">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full"
              style={{ backgroundColor: 'var(--co-amber-soft)' }}
            >
              <AlertTriangle className="h-8 w-8" style={{ color: 'var(--co-amber)' }} />
            </div>
            <div>
              <p className="text-[18px] font-bold text-[color:var(--co-text)]">{t.subRejectedTitle}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--co-text-muted)]">
                {t.subRejectedDesc}
              </p>
              <p className="mt-2 text-[11px] tabular-nums text-[color:var(--co-text-faint)]">
                {t.subReceiptRef}: {ticketRef}
              </p>
            </div>
            <div className="w-full space-y-2.5">
              <button
                onClick={() => {
                  setStep('pick');
                  resetTicketState();
                  recyclingRef.current = false;
                }}
                className="co-btn co-btn-primary py-4 text-[15px]"
              >
                <RefreshCw className="h-4 w-4" />
                {t.subTryAgain}
              </button>
              {supportLink && (
                <button
                  type="button"
                  onClick={() => openExternalLink(supportLink)}
                  className="co-btn co-btn-ghost py-4 text-[15px]"
                >
                  <MessageCircle className="h-4 w-4" />
                  {t.subContactAdminNow}
                </button>
              )}
            </div>
          </div>
        ) : !payTier ? (
          /* The plan behind this ticket no longer exists (deleted or
             renamed in the admin panel while the sheet was open). */
          <div key="noplan" className="co-enter mx-auto flex h-full max-w-[21rem] flex-col items-center justify-center gap-4 text-center">
            <AlertTriangle className="h-8 w-8" style={{ color: 'var(--co-amber)' }} />
            <p className="max-w-[17rem] text-[13px] leading-relaxed text-[color:var(--co-text-muted)]">
              {t.subQrMissing}
            </p>
            <button onClick={handleChangePlan} className="co-btn co-btn-ghost px-5 py-3.5 text-[15px]">
              {t.subChangePlan}
            </button>
          </div>
        ) : (
          /* ---------------------------- PAY / WAIT ---------------------------- */
          /* One small dialog, the way a checkout normally says "we are
             waiting on your bank" — not a screen full of blocks. The QR
             and the hand-off to ABA both live on the browser page now, so
             in here there is exactly one thing to do at a time. */
          <div key="pay" className="co-enter flex min-h-full items-center justify-center py-2">
            {/* The pass itself. The band carries the one number a payer
                may need to quote in a support chat, printed the way a
                ticket prints it. */}
            <div className="co-pass w-full max-w-[21rem]">
              <div className="co-pass-band">
                <span
                  className="text-[13px] tracking-[0.22em]"
                  style={{ fontFamily: 'var(--co-font-display)' }}
                >
                  {t.subVipPass}
                </span>
                <span className="font-mono text-[11px] tracking-[0.06em] text-white/85">
                  {ticketRef}
                </span>
              </div>

              <div className={payCompact ? 'p-4' : 'p-5'}>
              <div className="flex flex-col items-center text-center">
                {!payCompact && (
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: proofSent
                      ? 'var(--co-green-soft)'
                      : amountMismatch
                        ? 'var(--co-amber-soft)'
                        : 'rgba(255,255,255,0.05)',
                  }}
                >
                  {proofSent ? (
                    <Check className="h-6 w-6" style={{ color: 'var(--co-green)' }} />
                  ) : amountMismatch ? (
                    <AlertTriangle className="h-5 w-5" style={{ color: 'var(--co-amber)' }} />
                  ) : (
                    <Wallet className="h-5 w-5" style={{ color: 'var(--co-text-muted)' }} />
                  )}
                </span>
                )}
                <p className={`text-[15px] font-bold text-[color:var(--co-text)] ${payCompact ? '' : 'mt-3'}`}>
                  {proofSent
                    ? t.subVerifyingTitle
                    : amountMismatch
                      ? t.subAmountMismatchTitle
                      : t.subReadyQrTitle}
                </p>
                {/* With the ticket on screen the plan moves up here,
                    small and quiet, and the amount line below goes
                    away entirely: a 26px display figure sitting beside
                    a 13px Khmer plan name, directly above a ticket
                    printing the same figure again, was two mismatched
                    types arguing over one number. */}
                {ticketShowing && (
                  <p className="mt-1 text-[13px] font-bold text-[color:var(--co-text-dim)]">
                    {planLabel(payTier)}
                  </p>
                )}
                {!amountMismatch && !payCompact && (
                  <p className="mt-1.5 max-w-[17rem] text-[13px] leading-relaxed text-[color:var(--co-text-dim)]">
                    {proofSent ? t.subVerifyingFree : t.subReadyQrDesc}
                  </p>
                )}
              </div>

              {/* Below the tear: what the pass is for, the way a
                  printed one lists it. */}
              <div className={`co-tear -mx-5 ${payCompact ? 'my-3' : 'my-4'}`} />

              {!ticketShowing && (
              <div className="space-y-2.5">
                {!payCompact && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="shrink-0 text-[11px] text-[color:var(--co-text-dim)]">
                    {t.subReceiptPlan}
                  </span>
                  <span className="max-w-[64%] truncate text-[13px] font-bold text-[color:var(--co-text)]">
                    {planLabel(payTier)}
                  </span>
                </div>
                )}
                {/* The amount gets its own line, above the rule, the way
                    a total sits at the bottom of a bill. */}
                <div
                  className={`flex items-end justify-between gap-3 ${
                    payCompact ? '' : 'border-t border-[color:var(--co-line-soft)] pt-3'
                  }`}
                >
                  <span className="min-w-0 shrink pb-1 text-[11px] text-[color:var(--co-text-dim)]">
                    {payCompact ? (
                      <span className="block truncate font-bold text-[color:var(--co-text)]">
                        {planLabel(payTier)}
                      </span>
                    ) : (
                      t.subAmountDue
                    )}
                  </span>
                  {/* Printed exactly as the KHQR ticket below prints it
                      — same digits, same cents, same unit. The two used
                      to disagree ($2 up here, 2.00 USD on the ticket),
                      which is a moment of doubt on the one screen that
                      cannot afford one. */}
                  <span className="flex items-baseline gap-1.5">
                    <span
                      className="leading-none tabular-nums text-[color:var(--co-text)]"
                      style={{ fontFamily: 'var(--co-font-display)', fontSize: '26px', letterSpacing: '0.01em' }}
                    >
                      {formatAmount(payTier.price).value}
                    </span>
                    <span className="text-[11px] font-bold tracking-[0.1em] text-[color:var(--co-text-dim)]">
                      {formatAmount(payTier.price).unit}
                    </span>
                  </span>
                </div>
              </div>
              )}

              {/* The code itself, for anyone paying from another bank's
                  app. No save button: on a phone, "save" means a
                  screenshot, and every phone already has that gesture —
                  a button that downloads a PNG into a folder they then
                  have to find is a worse version of it. */}
              {!amountMismatch && !proofSent && (
                <div className="mt-4">
                  {/* Which bank to pay. Shown only when two templates are
                      configured: with one there is no choice to offer,
                      and the reason there can be two is that the banks
                      will not accept the same payload, not that anyone
                      wanted a setting. */}
                  {bakongConfig?.khqrTemplate && bakongConfig?.khqrTemplateAlt && (
                    <div className="mb-3.5">
                      <BankChoice
                        heading={t.subPayFrom}
                        primaryLabel={bakongConfig.bankLabel || 'Bank 1'}
                        altLabel={bakongConfig.bankLabelAlt || 'Bank 2'}
                        value={bank}
                        onChange={setBank}
                      />
                    </div>
                  )}
                  {qrSrc ? (
                    <>
                      {liveKhqr ? (
                        // A generated QR (Bakong config / pasted template)
                        // renders as a bare black-and-white square with no
                        // chrome of its own — KhqrCard draws the same red
                        // "KHQR" ticket band + name + amount a bank-issued
                        // one already has printed on it, so a generated QR
                        // reads exactly as trustworthy as an uploaded one.
                        <button
                          type="button"
                          onClick={() => setQrZoom(true)}
                          aria-label={t.subQrTapHint}
                          className="mx-auto block transition active:scale-[0.98]"
                        >
                          <KhqrCard
                            merchantName={payeeName ?? bakongConfig?.merchantName ?? planLabel(payTier)}
                            amount={payTier.price}
                            qrDataUrl={liveKhqr.image}
                          />
                        </button>
                      ) : (
                        <>
                          {/* An admin-uploaded image is usually already a
                              whole ticket graphic (a bank app screenshot),
                              so it isn't wrapped in another one — just a
                              small KHQR mark + name above it, when a name
                              is actually known from the payload. */}
                          <div className="mx-auto mb-2.5 flex max-w-[220px] flex-col items-center gap-1">
                            <img
                              src="/assets/khqr-logo.png"
                              alt="KHQR"
                              className="h-5 w-auto object-contain"
                            />
                            {(payeeName ?? bakongConfig?.merchantName) && (
                              <span className="truncate text-[13px] font-bold uppercase tracking-wide text-[color:var(--co-text)]">
                                {payeeName ?? bakongConfig?.merchantName}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setQrZoom(true)}
                            aria-label={t.subQrTapHint}
                            className="mx-auto block rounded-[var(--co-r-btn)] bg-white p-2 transition active:scale-[0.98]"
                          >
                            <img
                              src={qrSrc}
                              alt="KHQR"
                              className="h-[148px] w-[148px] object-contain"
                            />
                          </button>
                        </>
                      )}
                      <p className="mx-auto mt-2.5 max-w-[16rem] text-center text-[11px] leading-relaxed text-[color:var(--co-text-dim)]">
                        {t.subQrTapHint}
                      </p>

                      {/* The acceptance mark. With the bank chooser gone
                          this is what answers "will MY bank work?" — and
                          the KHQR mark is the answer, because that is
                          exactly what the mark means: one code, every
                          member bank's app. Printing a handful of
                          individual bank logos would say less and go
                          stale the moment a bank joins or leaves. */}
                      <div className="mx-auto mt-3 flex max-w-[17rem] flex-col items-center gap-1.5 border-t border-[color:var(--co-line-soft)] pt-3">
                        <img
                          src="/assets/khqr-logo.png"
                          alt="KHQR"
                          className="h-4 w-auto object-contain"
                        />
                        <span className="text-center text-[11px] leading-relaxed text-[color:var(--co-text-faint)]">
                          {t.subAllKhqrBanks}
                        </span>
                      </div>
                    </>
                  ) : (
                    amberNote(t.subQrMissing, <>{t.subQrMissingDesc}{contactAdminLink}</>)
                  )}
                </div>
              )}

              {/* The window draining. Deliberately plain: this is the
                  app telling the viewer it is watching for their
                  payment, not warning them about anything. It used to
                  be an amber panel with an alarm clock on it, which put
                  the loudest thing on the screen next to the one thing
                  nobody needs to act on. A spinner says "working", the
                  countdown says how long, and the bar shows it going —
                  amber is kept for the last-30-seconds prompt below,
                  where there IS something to decide. Stops once a
                  receipt is sent. */}
              {!proofSent && !amountMismatch && (
                <div className="mt-3.5 rounded-[var(--co-r-btn)] border border-[color:var(--co-line)] bg-white/[0.03] px-3.5 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-[color:var(--co-text-muted)]">
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                      <span className="truncate">{t.subWaitingPayment}</span>
                    </span>
                    {/* Monospaced so the digits do not shuffle sideways
                        every second as the glyph widths change. */}
                    <span
                      className="shrink-0 text-[15px] font-bold tabular-nums text-[color:var(--co-text-dim)]"
                      style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}
                    >
                      {mmss}
                    </span>
                  </div>
                  <div className="h-[3px] overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[color:var(--co-text-dim)] transition-[width] duration-1000 ease-linear"
                      style={{ width: `${waitPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Half a minute left and nothing sent: ask before the ticket
                  is recycled. People are slow inside ABA, and a screen that
                  wipes itself is what makes them give up. */}
              {showKeepWaiting && !amountMismatch && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-[var(--co-r-btn)] border border-[color:var(--co-amber-line)] bg-[color:var(--co-amber-soft)] px-3.5 py-2.5">
                  <span className="min-w-0 text-[11px] font-bold" style={{ color: 'var(--co-amber)' }}>
                    {t.subStillHereTitle}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSecondsLeft((s) => s + WAIT_WINDOW_SECONDS)}
                    className="shrink-0 rounded-[var(--co-r-btn)] border border-[color:var(--co-amber-line)] px-3 py-2 text-[11px] font-bold"
                    style={{ color: 'var(--co-amber)' }}
                  >
                    {t.subKeepWaiting}
                  </button>
                </div>
              )}

              {amountMismatch ? (
                <div className="mt-4">
                  {amberNote(
                    t.subAmountMismatchTitle,
                    <>
                      {t.subAmountMismatchDesc
                        .replace('{qr}', `$${(qrAmount ?? 0).toFixed(2)}`)
                        .replace('{plan}', `$${payTier.price.toFixed(2)}`)}
                      {contactAdminLink}
                    </>,
                  )}
                </div>
              ) : proofSent ? (
                <button onClick={onClose} className="co-btn co-btn-primary mt-4 py-3.5 text-[13px]">
                  {t.subCloseAndWatch}
                </button>
              ) : (
                <div className="mt-4 space-y-2.5">
                  {/* There is one thing to do on this screen once the
                      code is up: pay it, then send the receipt. So the
                      upload takes the only slot. */}
                  <div
                    ref={uploadBlockRef}
                    className={highlightUpload ? 'co-focus-ring rounded-[var(--co-r-btn)]' : ''}
                  >
                    {receiptUploadUi}
                  </div>

                  {error && (
                    <div>
                      {amberNote(
                        t.subUploadFailedTitle,
                        <>
                          {error}
                          <span className="mt-2 block text-[11px]">{t.subUploadFailedDesc}</span>
                          {contactAdminLink}
                        </>,
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Quiet text links, not buttons: everything below is a way
                  out, and none of it competes with the action above. */}
              <div className="mt-5 flex flex-col items-center gap-3 border-t border-[color:var(--co-line-soft)] pt-4">
                {!proofSent && (
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={handleChangePlan}
                      className="text-[11px] font-semibold text-[color:var(--co-text-dim)] underline decoration-[color:var(--co-line-strong)] underline-offset-4 transition hover:text-[color:var(--co-text)]"
                    >
                      {t.subChangePlan}
                    </button>
                  </div>
                )}

                <button
                  onClick={handleRequestClose}
                  className="text-[11px] font-semibold text-[color:var(--co-text-faint)] transition hover:text-[color:var(--co-text-muted)]"
                >
                  {t.subCloseBtn}
                </button>
              </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Sticky commit bar — only on the picker, so the price and the one
          action are always reachable no matter how long the list. */}
      {!checkingPending && step === 'pick' && (
        <footer
          className="relative z-10 shrink-0 border-t border-[color:var(--co-line)] px-4 pt-3"
          style={{
            paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
            backgroundColor: 'rgba(5,5,7,0.92)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          }}
        >
          <div className="mb-2.5 flex items-baseline justify-between">
            <span className="text-[11px] text-[color:var(--co-text-dim)]">{t.subTotalDue}</span>
            {/* The same figure, in the same face, as the amount on the
                pass two steps later. It used to be `$2` here and
                `2.00 USD` there — one price written two ways inside one
                purchase. */}
            <span className="flex items-baseline gap-1.5">
              <span
                className="leading-none tabular-nums text-[color:var(--co-text)]"
                style={{ fontFamily: 'var(--co-font-display)', fontSize: '22px', letterSpacing: '0.01em' }}
              >
                {tier ? formatAmount(tier.price).value : '—'}
              </span>
              {tier && (
                <span className="text-[11px] font-bold tracking-[0.1em] text-[color:var(--co-text-dim)]">
                  {formatAmount(tier.price).unit}
                </span>
              )}
            </span>
          </div>
          <button
            onClick={handlePickPlan}
            disabled={!tier || submitting}
            className="co-btn co-btn-primary py-4 text-[15px]"
          >
            {/* This opens the ticket on the server now that there is no
                method step in between, so it has to show that it is
                working — a slow network on a dead-looking button gets
                tapped twice. */}
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Crown className="h-4 w-4" />
            )}
            {t.subSelectPayment}
          </button>
          <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-[color:var(--co-text-faint)]">
            <ShieldCheck className="h-2.5 w-2.5" /> {t.subJoinVipNote}
          </p>
        </footer>
      )}
    </div>
  );
}
