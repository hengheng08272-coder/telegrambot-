import { useState } from 'react';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import { openAdminChat } from '@/lib/telegram';
import { acknowledgeWatchWarning, type WatchWarning } from '@/lib/watchGuard';

interface Props {
  warning: WatchWarning;
  onDismiss: () => void;
}

/**
 * Said once, plainly, before anything is taken away.
 *
 * Deliberately not styled as an accusation. The likeliest reader is
 * somebody whose video would not load and who tapped Next twenty times,
 * and telling that person they have been caught stealing loses a customer
 * over a buffering problem. So it names what the system saw, says what it
 * usually means, gives the way out — talk to the admin — and only then
 * mentions what happens if it keeps happening.
 */
export default function WatchWarningModal({ warning, onDismiss }: Props) {
  const { lang } = useLang();
  const t = appText[lang];
  const [busy, setBusy] = useState(false);

  const isFinal = warning.strike >= 2;

  const dismiss = async () => {
    setBusy(true);
    await acknowledgeWatchWarning(warning.id);
    onDismiss();
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-[3px]" />

      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-[360px] overflow-hidden rounded-3xl border border-[#FFC24D]/25 bg-[#12141C] p-5 text-center shadow-[0_30px_80px_rgba(0,0,0,0.7)]"
      >
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
            isFinal ? 'bg-[#FF6B60]/12' : 'bg-[#FFC24D]/12'
          }`}
        >
          <ShieldAlert className={`h-7 w-7 ${isFinal ? 'text-[#FF6B60]' : 'text-[#FFC24D]'}`} />
        </div>

        <h2 className="mt-3.5 text-[17px] font-bold leading-[1.5] text-white">
          {isFinal ? t.watchWarnTitleFinal : t.watchWarnTitle}
        </h2>

        <p className="mt-2 text-[13px] leading-[1.75] text-white/60">
          {(isFinal ? t.watchWarnBodyFinal : t.watchWarnBody)
            .replace('{count}', String(warning.distinct_episodes ?? warning.window_minutes))
            .replace('{minutes}', String(warning.window_minutes))}
        </p>

        <p className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-[12px] leading-[1.75] text-white/50">
          {t.watchWarnHint}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={openAdminChat}
            className="w-full rounded-full border border-[#4E86FF]/30 bg-[#4E86FF]/10 py-3 text-[13px] font-bold text-[#8FB4FF] transition active:scale-[0.98] hover:bg-[#4E86FF]/20"
          >
            {t.watchWarnContact}
          </button>
          <button
            onClick={dismiss}
            disabled={busy}
            className="flex w-full items-center justify-center rounded-full bg-white/[0.06] py-3 text-[13px] font-bold text-white/75 transition active:scale-[0.98] hover:bg-white/10 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.watchWarnUnderstood}
          </button>
        </div>
      </div>
    </div>
  );
}
