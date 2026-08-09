import { Smartphone, QrCode, ShieldCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';

const LOGO_URL = '/assets/images/logo-transparent.png';

interface DesktopBlockedScreenProps {
  onOpenAdminSignIn: () => void;
  authOpen: boolean;
  children?: ReactNode;
}

export default function DesktopBlockedScreen({
  onOpenAdminSignIn,
  authOpen,
  children,
}: DesktopBlockedScreenProps) {
  const [qrFailed, setQrFailed] = useState(false);
  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(
    currentUrl,
  )}`;

  if (authOpen) {
    // Admin sign-in flow requested — hand the whole screen to AuthScreen,
    // which the parent passes in as children. If they aren't actually an
    // admin, App.tsx will bounce them straight back to this gate.
    return <>{children}</>;
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0A0A0F] px-6 text-white">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#0F8F72]/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-[#E8A94A]/10 blur-3xl" />

      <div className="relative w-full max-w-sm rounded-[28px] border border-white/10 bg-[#111117]/90 p-8 text-center backdrop-blur-xl">
        <img src={LOGO_URL} alt="NINT ANIME" className="mx-auto mb-5 h-16 w-16 object-contain" />

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#E8A94A]/10">
          <Smartphone className="h-7 w-7 text-[#E8A94A]" />
        </div>

        <h1
          className="mb-2 text-xl font-extrabold tracking-wide"
          style={{ fontFamily: '"Bebas Neue", Battambang, Inter, sans-serif', letterSpacing: '0.03em' }}
        >
          Mobile Only
        </h1>
        <p className="mb-1 text-sm leading-relaxed text-white/70">
          គេហទំព័រនេះប្រើប្រាស់បានតែលើ <span className="font-semibold text-white">ទូរស័ព្ទ (Mobile)</span> ប៉ុណ្ណោះ។
          សូមបើកលីងនេះនៅលើទូរស័ព្ទរបស់អ្នក។
        </p>
        <p className="mb-6 text-xs leading-relaxed text-white/40">
          This site is only available on mobile devices. Please open this link on your phone.
        </p>

        {!qrFailed && currentUrl && (
          <div className="mx-auto mb-6 w-fit rounded-2xl border border-white/10 bg-white p-2.5">
            <img
              src={qrSrc}
              alt="Scan to open on mobile"
              className="h-32 w-32"
              onError={() => setQrFailed(true)}
            />
          </div>
        )}
        {!qrFailed && (
          <p className="mb-6 flex items-center justify-center gap-1.5 text-[11px] text-white/40">
            <QrCode className="h-3.5 w-3.5" /> ស្កេនដើម្បីបើកនៅលើទូរស័ព្ទ
          </p>
        )}

        <button
          onClick={onOpenAdminSignIn}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] py-3 text-xs font-semibold text-white/60 transition hover:border-[#E8A94A]/30 hover:text-white"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Admin Sign In (Desktop)
        </button>
      </div>
    </div>
  );
}
