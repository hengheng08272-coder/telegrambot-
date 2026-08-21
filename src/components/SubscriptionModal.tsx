import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Download,
  ImagePlus,
  Loader2,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { openExternalLink, isInTelegram } from '@/lib/telegram';
import {
  decodeKhqrFromImage,
  isKhqrPayload,
  buildAbaDeeplink,
  buildPayPageUrl,
  armDeeplinkFallback,
  readKhqrMerchant,
} from '@/lib/khqr';
import {
  fetchBakongConfig,
  generateKhqr,
  renderQrDataUrl,
  type BakongConfig,
} from '@/lib/bakong';
import KhqrCard from '@/components/KhqrCard';
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
  getPayLinks,
  getKhqrStrings,
  createAbaCheckout,
  type AbaCheckoutResult,
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
}

type Step = 'pick' | 'method' | 'pay';

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
  const [liveKhqr, setLiveKhqr] = useState<{ payload: string; md5: string; image: string } | null>(
    null,
  );
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
  // Set when the ABA hand-off was tapped and this page was still in the
  // foreground afterwards — i.e. nothing opened. Without this the tap
  // silently does nothing and the viewer has no idea whether to wait,
  // retry, or scan the QR instead.
  const [abaDidNotOpen, setAbaDidNotOpen] = useState(false);
  // Set the moment the viewer taps "Open ABA Mobile" — from then on the
  // primary action on the Auto tab switches from "go open the app" to
  // "upload the receipt", since they've already left once and the next
  // thing they do is come back with a screenshot. Reset on Change Plan /
  // a fresh ticket so a new payment starts on the open-app button again.
  const [abaOpened, setAbaOpened] = useState(false);
  // Armed when ABA is picked as the method from inside Telegram: the
  // checkout page is handed to the system browser as soon as this
  // ticket's KHQR exists, without waiting for a second tap. Telegram's
  // WebView cannot open `abamobilebank://` at all, so the in-app "Open
  // ABA" button was never the thing that opened the bank — it only ever
  // handed off to that page, and making the viewer tap twice for one
  // hand-off bought nothing. Cleared once it fires (or once it is clear
  // there is no page to hand off to).
  const [autoHandOff, setAutoHandOff] = useState(false);
  // True once the listening window lapsed and a replacement ticket was
  // opened in the background. The countdown silently restarting looked
  // like a glitch; this labels it instead (subTicketRenewed).
  const [ticketRenewed, setTicketRenewed] = useState(false);
  // Guards the header X (and Telegram/system back) while a ticket is
  // actively open — one accidental tap should never silently drop a
  // payment in progress, so it asks first instead of closing right away.
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const notifiedApprovedRef = useRef(false);
  const recyclingRef = useRef(false);
  // Mirrors payMode for the recycle effect, which must not re-run (and
  // re-open a ticket) just because the viewer's chosen method changed.
  const payModeRef = useRef(payMode);
  payModeRef.current = payMode;
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
        setSecondsLeft(Math.max(0, WAIT_WINDOW_SECONDS - elapsedSec));
        setStep('pay');
      }
    });
    getQrCodes().then(setQrImages);
    getPayLinks().then(setPayLinks);
    getKhqrStrings().then(setStoredKhqr);
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

    const countdown = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);

    return () => {
      window.clearInterval(pollInterval);
      window.clearInterval(countdown);
    };
  }, [step, pending, decision, liveKhqr]);

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
        setTicketRenewed(true);
        // Only the ABA tab ever uses a gateway transaction. Creating one
        // for a viewer paying by QR would open a PayWay transaction every
        // three minutes that nobody is ever going to complete.
        if (payModeRef.current === 'auto') setAbaCheckout(await createAbaCheckout(fresh.id));
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
  // Only ever the QR this owner uploaded. There used to be a bundled
  // fallback image here, which meant a tier with no QR of its own quietly
  // showed somebody else's KHQR — real money would have left for an
  // account this app doesn't own, and auto-confirm could never match it,
  // so the payer lost the money AND got no VIP. With no QR configured the
  // viewer now gets the "contact the admin" message instead (subQrMissing).
  const qrSrc = liveKhqr?.image ?? (payTier ? qrImages[payTier.key] ?? null : null);
  // Real gateway (server-verified, opens ABA app directly) takes
  // priority over the static admin-pasted PayWay link, which in turn
  // is only shown when the gateway isn't configured/failed.
  const gatewayLink = abaCheckout?.configured ? abaCheckout.deeplink || abaCheckout.checkoutUrl : null;
  const payLinkSrc = payTier ? gatewayLink || payLinks[payTier.key] || null : null;
  const isRealGateway = Boolean(gatewayLink);
  // A real gateway already hands us its own deeplink, so only fall back to
  // rebuilding one from the QR image when there isn't one.
  // Prefer the payload saved when the admin uploaded the QR; only fall
  // back to decoding the image in the browser when that is missing (old
  // uploads, or before the migration was run).
  const effectiveKhqr = liveKhqr?.payload ?? (payTier ? storedKhqr[payTier.key] : null) ?? khqrString;
  // Read back out of the payload that is actually on screen, so it can
  // never drift from what the payer's bank will show them.
  const payeeName = readKhqrMerchant(effectiveKhqr);
  const abaDeeplink =
    !isRealGateway && isKhqrPayload(effectiveKhqr) ? buildAbaDeeplink(effectiveKhqr) : null;

  // Inside Telegram the ABA deeplink can't be tapped straight from the
  // Mini App: it runs in Telegram's WebView, which swallows non-http
  // schemes, so the link does nothing at all. Telegram's openLink() does
  // hand an https URL to the system browser, so there the button opens
  // our own checkout page (public/pay/index.html) in Safari and the
  // viewer taps the deeplink from there, where iOS honours it. Outside
  // Telegram we are already in a real browser, so the direct deeplink
  // stays — no extra page in the way.
  const payPageUrl =
    isInTelegram() && isKhqrPayload(effectiveKhqr)
      ? buildPayPageUrl({
          khqr: effectiveKhqr,
          // A generated KHQR has no image URL to hand over (a rendered
          // data URL is far too long for a query string), so the page
          // draws that one from the payload itself. Only an uploaded
          // image travels as a link.
          qrSrc: liveKhqr ? null : qrSrc,
          plan: payTier ? (lang === 'km' ? payTier.labelKm : payTier.labelEn) : null,
          amount: payTier ? `$${payTier.price}` : null,
          ticket: pending ? pending.id.slice(0, 8).toUpperCase() : null,
          // The payload's own name first, the setting only as a fallback
          // — see the KHQR card below for why the two can differ.
          merchantName: payeeName ?? bakongConfig?.merchantName ?? null,
          lang,
        })
      : null;

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
  }, [bakongConfig, payTier, pending, lang]);

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
  useEffect(() => {
    if (!autoHandOff || step !== 'pay' || !pending) return;

    if (payPageUrl) {
      setAutoHandOff(false);
      setAbaOpened(true);
      setAbaDidNotOpen(false);
      openExternalLink(payPageUrl);
      return;
    }

    // No page to hand off to yet. Give the KHQR a few seconds to arrive,
    // then disarm: a tier with no payload at all (no Bakong config, no
    // stored KHQR, an undecodable image) must fall back to the ordinary
    // in-app button instead of leaving a hand-off primed to fire minutes
    // later, long after the viewer moved on.
    const timer = window.setTimeout(() => setAutoHandOff(false), 8000);
    return () => window.clearTimeout(timer);
  }, [autoHandOff, step, pending, payPageUrl]);

  // Everything a fresh payment attempt has to forget. Every exit from an
  // open ticket (change plan, change method, retry after a rejection)
  // runs through this — the retry path used to reset only some of it and
  // carried `abaOpened` over, which is why a second attempt opened on the
  // "upload your receipt" step for a payment that had never been started.
  const resetTicketState = () => {
    setPending(null);
    setAbaCheckout(null);
    setDecision('waiting');
    setSecondsLeft(WAIT_WINDOW_SECONDS);
    setReceipt(null);
    setProofSent(false);
    setAttachingProof(false);
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofFile(null);
    setProofPreviewUrl(null);
    setAbaOpened(false);
    setAbaDidNotOpen(false);
    setAutoHandOff(false);
    setTicketRenewed(false);
    setShowExitConfirm(false);
    setError('');
    notifiedApprovedRef.current = false;
  };

  // Picking a plan now only advances to the payment-method sheet — the
  // ticket itself isn't opened until the viewer actually picks ABA or
  // Other Bank there, so nothing is submitted for a plan they might
  // still change their mind about.
  const handlePickPlan = () => {
    if (!tier) return;
    setError('');
    setStep('method');
  };

  // Method sheet: ABA vs Other Bank / QR. Both open the same underlying
  // payment ticket — this only decides which tab the Pay screen opens
  // into. The admin is not messaged at this point either — only once
  // there's something for them to actually act on: an ABA webhook match,
  // or the viewer submitting a receipt photo (see handleAttachProof /
  // confirm-payment-proof, which sends the photo itself with
  // Confirm/Revoke buttons).
  const handleSelectMethod = async (mode: 'auto' | 'manual') => {
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
      setStep('method');
      return;
    }
    onSubmitted();
    resetTicketState();
    setPayMode(mode);
    payModeRef.current = mode;
    // Inside Telegram, picking ABA IS the hand-off: the checkout page
    // opens in the system browser by itself once this ticket's KHQR is
    // ready (see the hand-off effect). Outside Telegram nothing is armed
    // — there the deeplink is a real link the viewer taps directly, and
    // a browser would block a pop-up opened without a tap anyway.
    if (mode === 'auto' && isInTelegram()) setAutoHandOff(true);
    recyclingRef.current = false;
    const fresh = await getPendingSubmission();
    if (fresh) {
      setPending(fresh);
      if (mode === 'auto') setAbaCheckout(await createAbaCheckout(fresh.id));
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
    resetTicketState();
    setPayMode('auto');
    payModeRef.current = 'auto';
    recyclingRef.current = false;
  };

  // "Change Method" on the Pay screen — same idea as Change Plan (cancel
  // the open ticket right away, no 150s floor) but drops back to the
  // method sheet instead of the plan picker, since the plan itself is
  // still the right one.
  const handleChangeMethod = async () => {
    recyclingRef.current = true;
    if (pending) await cancelPaymentSubmission(pending.id);
    setStep('method');
    resetTicketState();
    recyclingRef.current = false;
  };

  // Header X (and the confirm sheet's own "Exit"): while a ticket is
  // open and still waiting, ask first instead of dropping straight out —
  // that's the one moment a stray tap costs the viewer real progress.
  const handleRequestClose = () => {
    if (step === 'pay' && decision === 'waiting' && !showExitConfirm) {
      setShowExitConfirm(true);
      return;
    }
    onClose();
  };

  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
  const waitPct = Math.max(0, Math.min(100, (secondsLeft / WAIT_WINDOW_SECONDS) * 100));
  const ticketRef = pending ? pending.id.slice(0, 8).toUpperCase() : '—';
  const planLabel = (tr: PricingTier | null) =>
    tr ? (lang === 'km' ? tr.labelKm : tr.labelEn) : '—';

  // Progress rail: which of the three checkout steps we are on. Terminal
  // states (paid / rejected) drop it — there is nothing left to step
  // through at that point.
  const stepIndex = step === 'pick' ? 0 : step === 'method' ? 1 : 2;
  const showStepRail = !checkingPending && (step !== 'pay' || decision === 'waiting');

  // One hand-off to ABA, rendered three different ways depending on what
  // this tier actually has: our own checkout page (inside Telegram, where
  // a WebView swallows non-http schemes), a real `abamobilebank://`
  // deeplink, or the admin's plain PayWay link. `primary` is the big
  // button shown before the viewer has left for ABA once; the quiet text
  // link afterwards uses the same targets, so the two can never drift.
  const abaAction = (primary: boolean, label: string) => {
    const className = primary
      ? 'flex w-full items-center justify-center gap-2 rounded-xl border border-[#7B5CFF]/30 bg-[#7B5CFF]/[0.16] py-3.5 text-[13px] font-bold text-[#CBD4FF] no-underline transition active:scale-[0.98] hover:bg-[#7B5CFF]/[0.26] hover:text-[#E2E7FF]'
      : 'flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.03] py-3 text-[12px] font-bold text-white/65 no-underline transition active:scale-[0.98] hover:border-white/25 hover:text-white';
    const body = (
      <>
        <Zap className={primary ? 'h-4 w-4 text-[#A3B4FF]' : 'h-3.5 w-3.5 text-[#A3B4FF]'} />
        {label}
      </>
    );
    const tapped = () => {
      setAbaDidNotOpen(false);
      if (primary) setAbaOpened(true);
    };

    // In Telegram: hand the checkout page to the system browser. No
    // armDeeplinkFallback here — this hand-off is a plain https URL, and
    // the "ABA didn't open" fallback now lives on that page, next to the
    // QR it falls back to.
    if (payPageUrl) {
      return (
        <button
          type="button"
          onClick={() => {
            tapped();
            openExternalLink(payPageUrl);
          }}
          className={className}
        >
          {body}
        </button>
      );
    }

    // A REAL <a href="abamobilebank://...">, not a button that assigns
    // location.href. Every WebView hands a non-http scheme to the OS when
    // the viewer taps an actual link; a scripted navigation to the same
    // string is routinely swallowed without an error, which is why the
    // deeplink "worked like text, not a link". The fallback is only armed
    // — the navigation itself belongs to the browser now.
    if (abaDeeplink) {
      return (
        <a
          href={abaDeeplink}
          rel="noreferrer"
          onClick={() => {
            tapped();
            // Only fall back when there is somewhere to fall back TO.
            // Tiers with no PayWay link rely on the deeplink alone; the
            // QR above stays as the manual route either way.
            armDeeplinkFallback(() => {
              if (payLinkSrc) openExternalLink(payLinkSrc);
              else setAbaDidNotOpen(true);
            });
          }}
          className={className}
        >
          {body}
        </a>
      );
    }

    if (payLinkSrc) {
      return (
        <button
          type="button"
          onClick={() => {
            tapped();
            openExternalLink(payLinkSrc);
          }}
          className={className}
        >
          {body}
        </button>
      );
    }

    return null;
  };

  // Shared receipt-upload widget: pick a screenshot, review it, tap Pay
  // to actually submit (that's the only moment the admin gets pinged).
  // Used on the Manual tab as-is, and on the Auto/ABA tab once the
  // viewer has already tapped through to the ABA app once — from that
  // point on it's the same auto-verify path as a manual payment.
  const receiptUploadUi = proofSent ? (
    <p className="flex items-center justify-center gap-1.5 rounded-xl border border-[#2FD98C]/25 bg-[#2FD98C]/[0.07] py-3 text-xs font-semibold text-[#2FD98C]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.subCheckingPayment}
    </p>
  ) : proofFile ? (
    <div className="space-y-2.5">
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20">
        {proofPreviewUrl && (
          <img src={proofPreviewUrl} alt="" className="max-h-48 w-full object-contain" />
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
        className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-extrabold disabled:opacity-50"
      >
        {attachingProof ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {attachingProof ? t.subUploadingProof : t.subPayNow}
      </button>
    </div>
  ) : (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-brand/35 bg-brand/[0.06] px-3.5 py-3 transition active:scale-[0.99] hover:border-brand/60">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/15">
        <ImagePlus className="h-4 w-4 text-brand" />
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
  );

  // Section shell — every block on the pay screen is one of these, so the
  // screen reads as a short list of labelled steps instead of one tall
  // card with everything crammed inside it.
  const section = (
    label: string,
    icon: ReactNode,
    body: ReactNode,
    action?: ReactNode,
  ) => (
    <section className="card-surface overflow-hidden rounded-card">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white/45">
          {icon}
          {label}
        </span>
        {action}
      </div>
      <div className="px-4 py-3.5">{body}</div>
    </section>
  );

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-app-deep">
      {/* Aurora backdrop — one quiet atmospheric layer: brand teal at the
          top, VIP gold at the bottom, nothing in between. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 40% at 50% -5%, rgba(18,231,198,0.12) 0%, rgba(4,5,10,0) 62%), radial-gradient(ellipse 80% 45% at 12% 108%, rgba(245,197,99,0.14) 0%, rgba(4,5,10,0) 60%)',
        }}
      />

      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between px-3">
        {step === 'method' ? (
          <button
            onClick={() => setStep('pick')}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 transition active:scale-90 hover:bg-white/10 hover:text-white"
            aria-label={t.back}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleRequestClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-white/60 transition active:scale-90 hover:bg-white/10 hover:text-white"
            aria-label={t.subCloseBtn}
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <span className="flex items-center gap-1.5 text-[13px] font-bold tracking-wide text-white/75">
          <Crown className="h-3.5 w-3.5 text-gold" />
          {t.subGoPremium}
        </span>
        <span className="h-9 w-9" />
      </header>

      {/* Step rail — three equal segments that fill in as the viewer moves
          Plan -> Method -> Pay. A checkout that opens a bank app and waits
          on a countdown needs to say where in the process you are; before
          this, every screen looked equally like the last one. */}
      {showStepRail && (
        <nav className="relative z-10 flex shrink-0 gap-2 px-4 pb-3.5" aria-label={t.subGoPremium}>
          {[t.subStepPlan, t.subStepMethod, t.subStepPay].map((label, i) => (
            <div key={label} className="flex flex-1 flex-col gap-1.5">
              <span
                className={`h-[3px] rounded-full transition-colors ${
                  i <= stepIndex ? 'bg-brand' : 'bg-white/[0.12]'
                }`}
              />
              <span
                className={`truncate text-[10px] font-semibold ${
                  i === stepIndex ? 'text-brand' : i < stepIndex ? 'text-white/45' : 'text-white/25'
                }`}
              >
                {i + 1}. {label}
              </span>
            </div>
          ))}
        </nav>
      )}

      {/* Exit-confirm sheet — the header X (and the hardware/Telegram back
          gesture, which also routes here) land on this instead of closing
          straight away whenever a ticket is open and still waiting. One
          accidental tap should never silently drop a payment in
          progress; this makes the choice explicit either way. */}
      {showExitConfirm && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm">
          <div className="w-full max-w-[19rem] rounded-sheet border border-white/[0.08] bg-[#0B0C14] p-5 text-center shadow-elevated">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gold/10">
              <AlertTriangle className="h-5 w-5 text-gold" />
            </div>
            <p className="text-sm font-bold text-white">{t.subExitConfirmTitle}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-white/50">{t.subExitConfirmDesc}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="btn-primary w-full rounded-xl py-3 text-xs font-extrabold"
              >
                {t.subExitConfirmContinue}
              </button>
              <button
                onClick={() => {
                  setShowExitConfirm(false);
                  onClose();
                }}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-3 text-xs font-bold text-white/60 transition active:scale-[0.98] hover:bg-white/[0.07] hover:text-white"
              >
                {t.subExitConfirmExit}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="relative z-10 flex-1 overflow-y-auto px-4 pb-6">
        {checkingPending ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/35" />
          </div>
        ) : step === 'pick' ? (
          /* ---------------------------- PLAN PICKER ---------------------------- */
          <>
            {/* Compact header: one gold eyebrow, one line of title, one
                line of promise. The old hero spent a third of the screen
                on a glowing logo before a single price was visible. */}
            <div className="flex flex-col items-center pb-4 text-center">
              <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-md border border-gold/25 bg-gold/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-gold">
                <Crown className="h-3 w-3" />
                {t.subTicketEyebrow}
              </div>
              <h2
                className="text-[24px] leading-tight text-white"
                style={{ fontFamily: '"Anton", Battambang, Inter, sans-serif', letterSpacing: '0.015em' }}
              >
                {t.subChoosePlan}
              </h2>
              <p className="mt-1 text-xs text-white/45">{t.subTagline}</p>
            </div>

            {/* Benefits, once, above the list — so the plan rows can be
                pure price comparison instead of each repeating the pitch. */}
            <div className="mb-3.5 grid grid-cols-3 gap-2">
              {(
                [
                  [ShieldCheck, t.subInstantUnlock, 'text-[#2FD98C]'],
                  [BadgeCheck, t.subFullAccess, 'text-brand'],
                  [Sparkles, t.subDrawAfterPay, 'text-gold'],
                ] as [typeof ShieldCheck, string, string][]
              ).map(([Icon, label, color]) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-1 rounded-card border border-white/[0.06] bg-white/[0.02] px-2 py-2 text-center"
                >
                  <Icon className={`h-3.5 w-3.5 ${color}`} />
                  <span className="text-[10px] leading-tight text-white/50">{label}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2.5">
              {visibleTiers.map((tr) => {
                const Icon = tierIcon(tr.months);
                const selected = tr.key === selectedKey;
                const perMonth = tr.months > 1 ? (tr.price / tr.months).toFixed(2) : null;
                const savePct =
                  baselinePerMonth > 0
                    ? Math.round((1 - tr.price / tr.months / baselinePerMonth) * 100)
                    : 0;
                return (
                  <button
                    key={tr.key}
                    onClick={() => setSelectedKey(tr.key)}
                    aria-pressed={selected}
                    className={`relative flex w-full items-center gap-3 overflow-hidden rounded-card border px-3.5 py-3 text-left transition-all active:scale-[0.99] ${
                      selected
                        ? 'border-gold/45 bg-gold/[0.06] shadow-glow-gold ring-1 ring-inset ring-gold/20'
                        : 'border-white/[0.08] bg-white/[0.025] hover:border-white/20'
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
                        selected ? 'bg-gold/15 ring-1 ring-gold/40' : 'bg-white/[0.07]'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${selected ? 'text-gold' : 'text-white/55'}`} />
                    </div>

                    {/* Two lines, each splitting left/right on its own,
                        rather than one text column beside one number
                        column. Sharing a column meant the widest thing on
                        either line set the width for both, so the
                        per-month figure was squeezing plan names into "3
                        Mo…". Split per line, the name has the whole row
                        minus the price, and every row still stands
                        exactly two lines tall. */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-bold text-white">{planLabel(tr)}</span>
                          {tr.badge === 'best' && (
                            <span className="shrink-0 rounded-md bg-gold/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gold">
                              {t.subBestValue}
                            </span>
                          )}
                          {tr.badge === 'popular' && (
                            <span className="shrink-0 rounded-md border border-brand/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand">
                              {t.subPopular}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-lg font-extrabold leading-none tabular-nums text-white">
                          ${tr.price}
                        </span>
                      </div>

                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        {/* The admin's own pitch for this tier stays on
                            the row — it is editable from Admin Panel ->
                            Subscriptions, so dropping it in favour of a
                            computed line would silently ignore what they
                            wrote there. */}
                        <span className="truncate text-[11px] text-white/40">{tr.pitchKm}</span>
                        {perMonth && (
                          <span className="shrink-0 text-[10px] tabular-nums text-white/35">
                            ${perMonth}
                            {t.subPerMonth}
                            {savePct >= 5 && (
                              <span className="ml-1 font-bold text-[#2FD98C]">−{savePct}%</span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Radio dot, not a tear-off stub: the row is a
                        choice in a list, and a dot says "one of these" at
                        a glance without adding a second row of chrome to
                        whichever plan happens to be picked. */}
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                        selected ? 'border-gold bg-gold' : 'border-white/20'
                      }`}
                    >
                      {selected && <Check className="h-3 w-3 text-[#1A1206]" strokeWidth={3.5} />}
                    </span>
                  </button>
                );
              })}
            </div>

            {error && (
              <p className="mt-4 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold-light">
                {error}
              </p>
            )}
          </>
        ) : step === 'method' ? (
          /* ---------------------------- PAYMENT METHOD ---------------------------- */
          <div>
            {/* What is being bought, kept on screen while the method is
                picked — the price was invisible on this step before, so
                the two decisions had to be held in the head at once. */}
            <div className="mb-5 flex items-center justify-between gap-3 rounded-card border border-gold/20 bg-gold/[0.05] px-4 py-3">
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-[0.16em] text-white/40">
                  {t.subReceiptPlan}
                </span>
                <span className="block truncate text-sm font-bold text-white">
                  {planLabel(tier)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-lg font-extrabold leading-none text-gold">
                  {tier ? `$${tier.price}` : '—'}
                </span>
                <button
                  type="button"
                  onClick={() => setStep('pick')}
                  className="mt-1 text-[10px] font-semibold text-white/40 underline decoration-white/20 underline-offset-2 transition hover:text-white/70"
                >
                  {t.subChangePlan}
                </button>
              </span>
            </div>

            <h2 className="mb-3 text-[13px] font-bold text-white/75">{t.subSelectPayment}</h2>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => handleSelectMethod('auto')}
                disabled={submitting}
                className="flex w-full items-center gap-3 rounded-card border border-[#7B5CFF]/25 bg-[#7B5CFF]/[0.08] px-4 py-4 text-left transition active:scale-[0.99] hover:border-[#7B5CFF]/45 disabled:opacity-50"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#7B5CFF]/20 ring-1 ring-[#7B5CFF]/30">
                  <Zap className="h-5 w-5 text-[#A3B4FF]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-white">{t.subMethodAbaTitle}</span>
                    <span className="rounded-md bg-[#7B5CFF]/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#CBD4FF]">
                      {t.subRecommended}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-white/45">{t.subMethodAbaDesc}</span>
                </span>
                {submitting ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/50" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSelectMethod('manual')}
                disabled={submitting}
                className="flex w-full items-center gap-3 rounded-card border border-white/[0.08] bg-white/[0.025] px-4 py-4 text-left transition active:scale-[0.99] hover:border-white/20 disabled:opacity-50"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.07]">
                  <QrCode className="h-5 w-5 text-white/60" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-white">{t.subMethodOtherTitle}</span>
                  <span className="mt-0.5 block text-[11px] text-white/45">
                    {t.subMethodOtherDesc}
                  </span>
                </span>
                {submitting ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/50" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/30" />
                )}
              </button>
            </div>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[10px] text-white/30">
              <ShieldCheck className="h-3 w-3 shrink-0 text-[#2FD98C]/70" />
              {t.subSecuredCheckout}
            </p>

            {error && (
              <p className="mt-4 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold-light">
                {error}
              </p>
            )}
          </div>
        ) : decision === 'approved' ? (
          /* ---------------------------- PAID (RECEIPT) ---------------------------- */
          <div className="flex h-full flex-col justify-center gap-5 py-4">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2FD98C]/12 ring-1 ring-[#2FD98C]/30">
                <Check className="h-8 w-8 text-[#2FD98C]" />
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
            <div className="gold-frame card-surface rounded-card px-4 py-1">
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
                className="btn-primary w-full rounded-xl py-3.5 text-sm font-bold"
              >
                <Sparkles className="mr-1.5 inline h-4 w-4" />
                {t.subGoDraw}
              </button>
              <button
                onClick={onClose}
                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-3.5 text-sm font-bold text-white/70 transition active:scale-[0.98] hover:bg-white/[0.07] hover:text-white"
              >
                {t.subStartWatching}
              </button>
            </div>
          </div>
        ) : decision === 'rejected' ? (
          /* ---------------------------- REJECTED ---------------------------- */
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gold/10">
              <X className="h-8 w-8 text-[#FF6B7C]" />
            </div>
            <div>
              <p className="text-lg font-bold text-white">{t.subRejectedTitle}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{t.subRejectedDesc}</p>
            </div>
            <button
              onClick={() => {
                setStep('pick');
                resetTicketState();
                setPayMode('auto');
                payModeRef.current = 'auto';
                recyclingRef.current = false;
              }}
              className="w-full rounded-xl border border-white/10 bg-white/5 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] hover:bg-white/10"
            >
              {t.subTryAgain}
            </button>
          </div>
        ) : !payTier ? (
          /* The plan behind this ticket no longer exists (deleted or
             renamed in the admin panel while the sheet was open). Without
             it there is no price and no QR to show, so say so instead of
             rendering an empty screen. */
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <AlertTriangle className="h-8 w-8 text-gold" />
            <p className="max-w-[17rem] text-sm leading-relaxed text-white/60">{t.subQrMissing}</p>
            <button
              onClick={handleChangePlan}
              className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white transition active:scale-[0.98] hover:bg-white/10"
            >
              {t.subChangePlan}
            </button>
          </div>
        ) : (
          /* ---------------------------- PAY / WAIT ---------------------------- */
          /* Three labelled blocks in the order the payment actually
             happens — what you owe, how to pay it, what we're doing about
             it — instead of one card with the summary, the QR, the
             countdown, the ABA button and the upload box all stacked
             centre-aligned inside the same border. */
          <div className="space-y-3">
            {ticketRenewed && (
              <p className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[11px] text-white/45">
                <RefreshCw className="h-3 w-3 shrink-0 text-brand" />
                {t.subTicketRenewed}
              </p>
            )}

            {/* ── 1. What is being paid for ───────────────────────────── */}
            {section(
              t.subOrderSummary,
              <Crown className="h-3 w-3 text-gold" />,
              /* Deliberately compact: on a small phone this block is all
                 that stands between opening the screen and seeing the QR,
                 and the amount is printed on the KHQR ticket itself a few
                 lines below — a second oversized copy of it here only
                 pushed the thing being paid with off-screen. */
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-white">
                      {planLabel(payTier)}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-white/40">
                      <span className="flex items-center gap-1 font-semibold text-white/55">
                        {payMode === 'auto' ? (
                          <Zap className="h-3 w-3 text-[#A3B4FF]" />
                        ) : (
                          <QrCode className="h-3 w-3 text-white/50" />
                        )}
                        {payMode === 'auto' ? t.subMethodAbaTitle : t.subMethodOtherTitle}
                      </span>
                      <span className="tabular-nums">· {ticketRef}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-xl font-extrabold leading-none text-white">
                    ${payTier.price}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleChangeMethod}
                    className="text-[11px] font-semibold text-white/40 underline decoration-white/20 underline-offset-2 transition hover:text-white/70"
                  >
                    {t.subChangeMethod}
                  </button>
                  <button
                    type="button"
                    onClick={handleChangePlan}
                    className="text-[11px] font-semibold text-white/40 underline decoration-white/20 underline-offset-2 transition hover:text-white/70"
                  >
                    {t.subChangePlan}
                  </button>
                </div>
              </>,
            )}

            {/* ── 2. How to pay it ────────────────────────────────────── */}
            {section(
              t.subPayTitle,
              <QrCode className="h-3 w-3 text-brand" />,
              <>
                {liveKhqr && bakongConfig ? (
                  /* A generated payload is a bare QR, so it gets the KHQR
                     ticket drawn around it. An uploaded picture already is
                     one and goes through untouched below — framing it twice
                     would put two headers on the same card.

                     The name is read back out of the payload, not taken
                     from the setting. With a pasted bank template — the
                     setup the notes actually recommend — "display name"
                     is left blank so the QR keeps the name the bank
                     wrote, and `bakongConfig.merchantName` is then the
                     empty string. Printing that put a KHQR ticket on
                     screen with a blank payee line, right above a
                     sentence naming the payee correctly. */
                  <KhqrCard
                    merchantName={payeeName || bakongConfig.merchantName}
                    amount={payTier.price}
                    qrDataUrl={liveKhqr.image}
                  />
                ) : qrSrc ? (
                  <img
                    src={qrSrc}
                    alt="KHQR"
                    className="mx-auto w-full max-w-[220px] rounded-xl border border-white/10 bg-white p-2 shadow-card"
                  />
                ) : (
                  <p className="rounded-xl border border-gold/25 bg-gold/[0.06] p-3.5 text-center text-xs leading-relaxed text-gold-light">
                    {t.subQrMissing}
                  </p>
                )}

                {qrSrc && (
                  <p className="mt-2.5 text-center text-[10px] text-white/35">{t.subScanHint}</p>
                )}

                {/* The payee name a member is about to see in their banking
                    app, said here first.

                    A bank prints the name registered to the receiving
                    account, and for a personal account that is a person,
                    not this service. Meeting an unfamiliar person's name
                    on the confirm screen is exactly what a careful payer
                    treats as a scam — so it is named in advance, sourced
                    from the payload actually being shown rather than
                    typed in somewhere, which keeps it honest if the QR
                    ever changes. */}
                {payeeName && (
                  <p className="mx-auto mt-2.5 max-w-[268px] text-center text-[11px] leading-relaxed text-white/45">
                    {t.subPayeeIntro} <b className="text-white/75">{payeeName}</b>
                    {' — '}
                    {t.subPayeeReassure}
                  </p>
                )}

                {payMode === 'auto' ? (
                  <div className="mt-3.5 space-y-2.5">
                    {abaOpened ? (
                      // The viewer has been handed off once already. The
                      // primary action moved to the status block below, so
                      // what stays here is the way back to the checkout
                      // page — a bordered button rather than a small link,
                      // because after an automatic hand-off a viewer who
                      // lost that tab has nothing else to tap.
                      <>
                        <p className="flex items-start gap-1.5 rounded-xl border border-[#7B5CFF]/20 bg-[#7B5CFF]/[0.07] px-3 py-2.5 text-left text-[11px] leading-relaxed text-[#CBD4FF]">
                          <ShieldCheck className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[#A3B4FF]" />
                          {t.subHandedOffNote}
                        </p>
                        {/* Inside Telegram this reopens our checkout
                            page, not the bank — say which, so the button
                            matches what appears. */}
                        {abaAction(
                          false,
                          payPageUrl ? t.subOpenPayPageAgain : t.subOpenAbaAgain,
                        )}
                      </>
                    ) : (
                      <>
                        {abaAction(true, t.subOpenAba) ?? (
                          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-white/40">
                            {t.subQrCaption}
                          </p>
                        )}

                        {/* The same target as the button, but rendered as
                            a plain visible link. Long-press gives "Open in
                            ABA" / "Copy", which is the exact form the owner
                            verified by hand in Notes — so if the styled
                            button ever fails, the thing that is known to
                            work is right there instead of nowhere. */}
                        {abaDeeplink && abaDidNotOpen && (
                          <div className="rounded-xl border border-gold/25 bg-gold/[0.07] px-3 py-2.5">
                            <p className="flex items-start gap-1.5 text-[11px] font-semibold leading-relaxed text-gold">
                              <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
                              {t.subAbaDidNotOpen}
                            </p>
                            <a
                              href={abaDeeplink}
                              rel="noreferrer"
                              className="mt-1.5 block break-all text-[10px] leading-relaxed text-[#B6C3FF] underline decoration-[#B6C3FF]/40 underline-offset-2"
                            >
                              {abaDeeplink}
                            </a>
                          </div>
                        )}

                        {/* Reassurance sits directly under the primary
                            action, where the hesitation actually happens. */}
                        <p className="flex items-start justify-center gap-1.5 px-1 text-center text-[10px] leading-relaxed text-white/45">
                          <ShieldCheck className="mt-[1px] h-3 w-3 shrink-0 text-[#2FD98C]/70" />
                          <span>
                            {isRealGateway ? t.subGatewayVerifiedNote : t.subGatewayManualNote}
                          </span>
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  qrSrc && (
                    <div className="mt-3.5 space-y-2.5">
                      <a
                        href={qrSrc}
                        download={`nintanime-vip-${payTier.key}.png`}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 py-3 text-xs font-bold text-white/70 transition active:scale-[0.98] hover:border-white/35 hover:text-white"
                      >
                        <Download className="h-3.5 w-3.5" /> {t.subSaveQr}
                      </a>
                      <p className="text-[11px] leading-relaxed text-white/45">
                        {t.subManualFlowNote}
                      </p>
                    </div>
                  )
                )}
              </>,
            )}

            {/* ── 3. What we are doing about it ───────────────────────── */}
            {section(
              t.subAutoWaitTitle,
              <Loader2 className="h-3 w-3 animate-spin text-brand" />,
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-white/45">{t.subCooldownNote}</span>
                  <span className="text-lg font-extrabold tabular-nums text-white">{mmss}</span>
                </div>
                {/* The window draining, drawn rather than counted: a bare
                    mm:ss says nothing about how much of the wait is left. */}
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-1000 ease-linear"
                    style={{ width: `${waitPct}%` }}
                  />
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-white/45">
                  {t.subAutoWaitDesc}
                </p>

                {/* Receipt upload — the fast lane out of the wait. On the
                    ABA tab it only appears once the viewer has actually
                    been sent to the bank app; before that there is nothing
                    to screenshot yet. */}
                {(payMode === 'manual' || abaOpened) && (
                  <div className="mt-3.5 border-t border-white/[0.06] pt-3.5">
                    {payMode === 'auto' && !proofSent && !proofFile && (
                      <p className="mb-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-white/45">
                        <ImagePlus className="mt-[1px] h-3.5 w-3.5 shrink-0 text-[#A3B4FF]" />
                        {t.subAbaScreenshotNote}
                      </p>
                    )}
                    {receiptUploadUi}
                  </div>
                )}
              </>,
            )}

            {error && (
              <p className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold-light">
                {error}
              </p>
            )}

            <button
              onClick={handleRequestClose}
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-3.5 text-sm font-bold text-white/70 transition active:scale-[0.98] hover:bg-white/[0.07] hover:text-white"
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
            onClick={handlePickPlan}
            disabled={!tier}
            className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-4 text-sm font-extrabold disabled:opacity-40"
          >
            <Crown className="h-4 w-4" />
            {t.subSelectPayment}
          </button>
          <p className="mt-2 flex items-center justify-center gap-1 text-[10px] text-white/28">
            <Send className="h-2.5 w-2.5" /> {t.subJoinVipNote}
          </p>
        </footer>
      )}
    </div>
  );
}
