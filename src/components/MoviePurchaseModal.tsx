import { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, Play, X } from 'lucide-react';
import type { Show } from '@/lib/types';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import {
  MOVIE_PRICE,
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

export default function MoviePurchaseModal({ show, onClose, onUnlocked }: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const [phase, setPhase] = useState<Phase>('loading');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const notifiedRef = useRef(false);

  // Open (or resume) a ticket for this exact show, and load the shared
  // $1 movie QR — one row in payment_qr_codes, not per-movie.
  useEffect(() => {
    let active = true;
    (async () => {
      const [pending, qr] = await Promise.all([getPendingMoviePurchase(show.id), getMovieQr()]);
      if (!active) return;
      setQrSrc(qr.imageUrl);
      if (pending) {
        setSubmissionId(pending.id);
        setPhase('pay');
        return;
      }
      const { id } = await submitMoviePurchaseIntent(show.id);
      if (!active) return;
      setSubmissionId(id);
      setPhase('pay');
    })();
    return () => {
      active = false;
    };
  }, [show.id]);

  // Once a screenshot is sent, confirm-movie-payment-proof grants the
  // unlock synchronously — but poll a few times right after in case the
  // admin reviews (rejects) within the first seconds, same courtesy the
  // VIP flow gives.
  useEffect(() => {
    if (phase !== 'sending' || !submissionId) return;
    const poll = window.setInterval(async () => {
      const status = await checkMoviePurchaseStatus(submissionId);
      if (status === 'rejected') {
        setPhase('rejected');
      }
    }, 3000);
    return () => window.clearInterval(poll);
  }, [phase, submissionId]);

  useEffect(() => {
    if (phase !== 'unlocked' || notifiedRef.current) return;
    notifiedRef.current = true;
    onUnlocked(show.id);
  }, [phase, onUnlocked, show.id]);

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

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-app-deep">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 40% at 50% -5%, rgba(32,80,216,0.14) 0%, rgba(4,5,10,0) 62%)',
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
        <span className="max-w-[65%] truncate text-[13px] font-bold tracking-wide text-white/75">
          {t.buyMovie ?? 'Buy Movie'}
        </span>
        <span className="h-9 w-9" />
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto px-4 pb-6">
        {phase === 'loading' ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/35" />
          </div>
        ) : phase === 'unlocked' ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2FD98C]/10">
              <Check className="h-8 w-8 text-[#2FD98C]" />
            </div>
            <div>
              <p className="text-lg font-bold text-white">{t.movieUnlockedTitle ?? 'Unlocked!'}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/55">
                {t.movieUnlockedDesc ?? 'This movie is yours to watch now.'}
              </p>
            </div>
            <button onClick={onClose} className="btn-primary w-full rounded-full py-3.5 text-sm font-bold">
              <Play className="mr-1.5 inline h-4 w-4 fill-current" />
              {t.playMovie}
            </button>
          </div>
        ) : phase === 'rejected' ? (
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
                setPhase('pay');
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
          <div className="space-y-4 pb-2">
            <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
              <img
                src={show.poster_url ?? show.banner_url ?? ''}
                alt=""
                className="h-16 w-11 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
              />
              <p className="min-w-0 truncate text-sm font-semibold text-white">{show.title}</p>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-[#2050D8]/20 bg-white/[0.03] p-4 text-center">
              <p className="text-[11px] uppercase tracking-[0.16em] text-white/40">{t.subTotalDue}</p>
              <p className="mt-1 text-[28px] font-extrabold leading-none text-white">
                ${MOVIE_PRICE}
                <span className="ml-1.5 text-sm font-medium text-white/40">
                  / {t.movie}
                </span>
              </p>

              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt="KHQR"
                  className="mx-auto mt-3.5 w-full max-w-[220px] rounded-xl border border-white/10 bg-white p-2 shadow-[0_10px_34px_rgba(0,0,0,0.55)]"
                />
              ) : (
                <p className="mt-4 rounded-xl border border-[#2050D8]/25 bg-[#2050D8]/5 p-4 text-xs text-[#2050D8]">
                  {t.subQrMissing}
                </p>
              )}

            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
              <p className="mb-3 text-xs font-semibold text-white/60">
                {t.movieUploadReceipt ?? 'Paid? Attach your receipt to unlock instantly.'}
              </p>

              {proofPreviewUrl ? (
                <div className="space-y-3">
                  <img
                    src={proofPreviewUrl}
                    alt=""
                    className="mx-auto max-h-52 rounded-xl border border-white/10 object-contain"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
                        setProofFile(null);
                        setProofPreviewUrl(null);
                      }}
                      disabled={phase === 'sending'}
                      className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-white/70 transition active:scale-[0.98] hover:bg-white/10 disabled:opacity-50"
                    >
                      {t.movieChangeScreenshot ?? 'Change'}
                    </button>
                    <button
                      onClick={handleSubmitProof}
                      disabled={phase === 'sending'}
                      className="btn-primary flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-bold disabled:opacity-60"
                    >
                      {phase === 'sending' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        t.movieConfirmPay ?? 'Confirm Payment'
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] py-4 text-sm font-semibold text-white/60 transition hover:border-[#2050D8]/40 hover:text-white"
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
      </main>
    </div>
  );
}
