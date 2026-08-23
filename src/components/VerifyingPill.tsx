import { Loader2 } from 'lucide-react';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';

interface Props {
  onClick: () => void;
}

/**
 * "Still checking your payment" — a small pill that floats over whatever
 * the viewer is watching, and reopens the payment sheet when tapped.
 *
 * Waiting is not an activity. Once a receipt is on its way to the admin
 * there is nothing left for the payer to do, so holding them on the
 * checkout screen only teaches them that paying costs them their evening.
 * They close the sheet, go and watch something, and this keeps the ticket
 * one tap away — the sheet reopens on the same ticket because it re-reads
 * the pending submission when it mounts.
 *
 * Styled from the checkout tokens (public/checkout-theme.css) so it reads
 * as part of the payment flow rather than part of the player UI.
 */
export default function VerifyingPill({ onClick }: Props) {
  const { lang } = useLang();
  const t = appText[lang];

  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed left-1/2 z-[80] flex min-h-[38px] -translate-x-1/2 items-center gap-2 rounded-[var(--co-r-pill)] px-4 text-[13px] font-bold shadow-[var(--co-shadow-card)] transition active:scale-95"
      style={{
        top: 'max(12px, env(safe-area-inset-top))',
        backgroundColor: 'var(--co-card)',
        border: '1px solid var(--co-green-line)',
        color: 'var(--co-green)',
      }}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {t.subVerifyingPill}
    </button>
  );
}
