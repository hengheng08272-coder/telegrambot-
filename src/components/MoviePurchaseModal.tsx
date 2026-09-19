import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, Play, X } from 'lucide-react';
import type { Show } from '@/lib/types';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import { formatAmount, type Currency } from '@/lib/format';
import { fetchBakongConfig, generateKhqr, renderQrDataUrl, type BakongConfig } from '@/lib/bakong';
import { readKhqrMerchant } from '@/lib/khqr';
import KhqrCard from '@/components/KhqrCard';
import BankChoice from '@/components/BankChoice';
import {
  getMovieQr,
  getPendingMoviePurchase,
  submitMoviePurchaseIntent,
  attachMovieScreenshot,
  checkMoviePurchaseStatus,
} from '@/lib/moviePurchase';

interface Props {
  show: Show;
  onClose: () => void;
  onUnlocked: (showId: string) => void;
}

type Phase = 'loading' | 'pay' | 'sending' | 'unlocked' | 'rejected';

/**
 * Buying one film.
 *
 * Built as an ordinary centred dialog rather than the full-screen sheet
 * this used to be. A sheet that swallows the whole app reads as "you are
 * now somewhere else and something big is happening", which is the wrong
 * note for a one-dollar purchase — and it pushed the QR into a tall
 * scrolling column, so the thing the viewer actually came to scan was
 * rarely the thing on screen. A dialog keeps the app visible behind it,
 * says "this will be quick", and leaves the QR at the top where it
 * belongs.
 *
 * Everything about the money comes from the SERVER's ticket, never from
 * a price this component worked out — see submitMoviePurchaseIntent.
 */
export default function MoviePurchaseModal({ show, onClose, onUnlocked }: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const [phase, setPhase] = useState<Phase>('loading');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [bakongConfig, setBakongConfig] = useState<BakongConfig | null>(null);
  // Which bank's QR is on screen. Only ever visible when the owner has
  // pasted two, which they do because the banks disagree about what a
  // payload may say — see BakongConfig.khqrTemplateAlt.
  const [bank, setBank] = useState<'primary' | 'alt'>('primary');
  const [liveKhqr, setLiveKhqr] = useState<{ payload: string; image: string } | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notifiedRef = useRef(false);

  // Open (or resume) the ticket, then read it back. The read is not
  // redundant: create_movie_purchase decides the price and currency
  // server-side and returns only an id, so the row IS the price. Anything
  // this component displayed without reading it back would be a guess.
  useEffect(() => {
    let active = true;
    (async () => {
      const [, qr] = await Promise.all([submitMoviePurchaseIntent(show.id), getMovieQr()]);
      if (!active) return;
      setQrSrc(qr.imageUrl);
      const ticket = await getPendingMoviePurchase(show.id);
      if (!active) return;
      if (ticket) {
        setSubmissionId(ticket.id);
        setPrice(Number(ticket.amount));
        setCurrency(ticket.currency ?? 'USD');
      }
      setPhase('pay');
    })();
    return () => {
      active = false;
    };
  }, [show.id]);

  // The owner's Bakong details, read once when the dialog opens — same
  // source SubscriptionModal reads, so the movie QR gets the same badge
  // and merchant name instead of whatever static image happened to be
  // uploaded to payment_qr_codes' "movie" row, which goes stale the
  // moment that image's own styling falls behind (see qrSrc fallback
  // below for what still shows if no Bakong config is set at all).
  useEffect(() => {
    let cancelled = false;
    fetchBakongConfig().then((cfg) => {
      if (!cancelled) setBakongConfig(cfg);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // One freshly-generated KHQR per ticket, same pattern as
  // SubscriptionModal's liveKhqr — regenerated if the ticket or its price
  // changes so a resumed purchase still carries a live bill number and
  // the amount the row currently says.
  useEffect(() => {
    let cancelled = false;
    if (!bakongConfig || !submissionId || !price) {
      setLiveKhqr(null);
      return;
    }
    (async () => {
      const generated = await generateKhqr({
        config: bakongConfig,
        amount: price,
        currency,
        bank,
        billNumber: submissionId.slice(0, 8).toUpperCase(),
        storeLabel: show.title,
      });
      if (cancelled || !generated) {
        if (!cancelled) setLiveKhqr(null);
        return;
      }
      const image = await renderQrDataUrl(generated.payload);
      if (cancelled) return;
      setLiveKhqr(image ? { payload: generated.payload, image } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [bakongConfig, submissionId, price, currency, bank, show.title]);

  // Once a screenshot is sent, confirm-movie-payment-proof grants the
  // unlock synchronously — but poll a few times right after in case the
  // admin reviews (rejects) within the first seconds, same courtesy the
  // VIP flow gives.
  useEffect(() => {
    if (phase !== 'sending' || !submissionId) return;
    const poll = window.setInterval(async () => {
      const status = await checkMoviePurchaseStatus(submissionId);
      if (status === 'rejected') setPhase('rejected');
    }, 3000);
    return () => window.clearInterval(poll);
  }, [phase, submissionId]);

  // The ABA relay can confirm this without the viewer sending anything at
  // all, so the pay screen watches its own ticket too. Without this, a
  // viewer who pays by QR and simply waits sits on the pay screen forever
  // while the film is already theirs.
  useEffect(() => {
    if (phase !== 'pay' || !submissionId) return;
    const poll = window.setInterval(async () => {
      const status = await checkMoviePurchaseStatus(submissionId);
      if (status === 'approved') setPhase('unlocked');
      else if (status === 'rejected') setPhase('rejected');
    }, 4000);
    return () => window.clearInterval(poll);
  }, [phase, submissionId]);

  useEffect(() => {
    if (phase !== 'unlocked' || notifiedRef.current) return;
    notifiedRef.current = true;
    onUnlocked(show.id);
  }, [phase, onUnlocked, show.id]);

  // Esc closes, like every other dialog on the platform.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const clearProof = () => {
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofFile(null);
    setProofPreviewUrl(null);
  };

  const handlePickFile = (file: File) => {
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setError('');
    setProofFile(file);
    setProofPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmitProof = async () => {
    if (!submissionId || !proofFile) return;
    setPhase('sending');
    setError('');
    const { error: err } = await attachMovieScreenshot(submissionId, proofFile);
    if (err) {
      setError(err);
      setPhase('pay');
      return;
    }
    setPhase('unlocked');
  };

  const money = price !== null ? formatAmount(price, currency) : null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      {/* Backdrop. Clicking it closes, which is what makes this read as a
          dialog rather than as a screen the viewer got sent to. */}
      <button
        aria-label={t.subCloseBtn}
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-[3px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[92dvh] w-full max-w-[380px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#11141D] shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <span className="text-[13px] font-bold tracking-wide text-white/80">
            {t.buyMovie ?? 'Buy Movie'}
          </span>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/55 transition active:scale-90 hover:bg-white/10 hover:text-white"
            aria-label={t.subCloseBtn}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {phase === 'loading' ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/35" />
            </div>
          ) : phase === 'unlocked' ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2FD98C]/10">
                <Check className="h-8 w-8 text-[#2FD98C]" />
              </div>
              <div>
                <p className="text-lg font-bold text-white">{t.movieUnlockedTitle ?? 'Unlocked!'}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-white/55">
                  {t.movieUnlockedDesc ?? 'This movie is yours to watch now.'}
                </p>
              </div>
              <button
                onClick={onClose}
                className="btn-primary w-full rounded-full py-3.5 text-sm font-bold"
              >
                <Play className="mr-1.5 inline h-4 w-4 fill-current" />
                {t.playMovie}
              </button>
            </div>
          ) : phase === 'rejected' ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FFC24D]/10">
                <X className="h-8 w-8 text-[#FF6B66]" />
              </div>
              <div>
                <p className="text-lg font-bold text-white">{t.subRejectedTitle}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-white/55">{t.subRejectedDesc}</p>
              </div>
              <button
                onClick={() => {
                  setPhase('pay');
                  clearProof();
                }}
                className="w-full rounded-full border border-white/10 bg-white/5 py-3.5 text-sm font-bold text-white transition active:scale-[0.98] hover:bg-white/10"
              >
                {t.subTryAgain}
              </button>
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* What is being bought, and for how much — one line each,
                  side by side, so neither needs its own card. */}
              <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-2.5">
                <img
                  src={show.poster_url ?? show.banner_url ?? ''}
                  alt=""
                  className="h-14 w-10 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-white">{show.title}</p>
                  <p className="mt-0.5 text-[11px] text-white/40">{t.movieOneOff}</p>
                </div>
                {money && (
                  <div className="shrink-0 text-right">
                    <p className="co-label text-white/35">
                      {t.subTotalDue}
                    </p>
                    <p className="text-[19px] font-extrabold leading-tight tabular-nums text-white">
                      {money.value}
                      <span className="ml-1 text-[11px] font-semibold text-white/45">
                        {money.unit}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              {/* Which bank to pay. Shown only when two are configured,
                  because with one there is no choice to offer — and the
                  reason there can be two is that the banks will not
                  accept the same payload, not that anyone wanted a
                  setting. */}
              {bakongConfig?.khqrTemplate && bakongConfig?.khqrTemplateAlt && (
                <BankChoice
                  heading={t.subPayFrom}
                  primaryLabel={bakongConfig.bankLabel || 'Bank 1'}
                  altLabel={bakongConfig.bankLabelAlt || 'Bank 2'}
                  value={bank}
                  onChange={setBank}
                />
              )}

              {/* The QR, given the whole width. This is what the dialog is
                  for — everything else on screen is a label for it. */}
              {liveKhqr && price !== null ? (
                <KhqrCard
                  size="full"
                  merchantName={
                    readKhqrMerchant(liveKhqr.payload) ?? bakongConfig?.merchantName ?? show.title
                  }
                  amount={price}
                  currency={currency}
                  qrDataUrl={liveKhqr.image}
                />
              ) : qrSrc ? (
                <img
                  src={qrSrc}
                  alt="KHQR"
                  className="mx-auto w-full max-w-[244px] rounded-2xl border border-white/10 bg-white p-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
                />
              ) : (
                <p className="rounded-xl border border-[#2050D8]/25 bg-[#2050D8]/5 p-4 text-center text-xs text-[#5B93FF]">
                  {t.subQrMissing}
                </p>
              )}

              <p className="text-center text-[11px] leading-relaxed text-white/40">
                {t.movieScanHint ?? 'Scan with any banking app. Unlocks automatically once paid.'}
              </p>

              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
                <p className="mb-2.5 text-[11px] font-semibold text-white/55">
                  {t.movieUploadReceipt ?? 'Paid? Attach your receipt to unlock instantly.'}
                </p>

                {proofPreviewUrl ? (
                  <div className="space-y-2.5">
                    <img
                      src={proofPreviewUrl}
                      alt=""
                      className="mx-auto max-h-40 rounded-xl border border-white/10 object-contain"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={clearProof}
                        disabled={phase === 'sending'}
                        className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-[13px] font-bold text-white/70 transition active:scale-[0.98] hover:bg-white/10 disabled:opacity-50"
                      >
                        {t.movieChangeScreenshot ?? 'Change'}
                      </button>
                      <button
                        onClick={handleSubmitProof}
                        disabled={phase === 'sending'}
                        className="btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-bold disabled:opacity-60"
                      >
                        {phase === 'sending' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          (t.movieConfirmPay ?? 'Confirm Payment')
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] py-3 text-[13px] font-semibold text-white/60 transition hover:border-[#2050D8]/40 hover:text-white"
                  >
                    <ImagePlus className="h-4 w-4" /> {t.subManualTab}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handlePickFile(f);
                  }}
                />
              </div>

              {error && <p className="text-center text-xs text-[#FF6B66]">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
