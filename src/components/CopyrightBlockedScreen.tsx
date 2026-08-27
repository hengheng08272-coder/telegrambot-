import { ShieldAlert } from 'lucide-react';

const LOGO_URL = '/assets/logo-transparent.png';

interface Props {
  /** Optional note the admin attached when blocking this viewer — not
   *  shown as-is (a blocked viewer doesn't need the internal reason),
   *  kept only so a future version could surface it if that's ever
   *  wanted. */
  reason?: string | null;
}

// Shown instead of the whole app for any Telegram id/username the admin
// has added to the block list (see BlockedUsersPanel + lib/api.ts's
// checkTelegramUserBlocked). Reads as a takedown notice rather than a
// personal ban message — deliberately gives the viewer nothing to argue
// with or work around.
export default function CopyrightBlockedScreen({ reason: _reason }: Props) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app px-6 text-white">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#E6231F]/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-[#E6231F]/10 blur-3xl" />

      <div className="relative w-full max-w-sm rounded-[28px] border border-[#E6231F]/20 bg-[#0E1017]/90 p-8 text-center backdrop-blur-xl">
        <img src={LOGO_URL} alt="NINT ANIME" className="mx-auto mb-5 h-14 w-14 object-contain opacity-70" />

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#E6231F]/10">
          <ShieldAlert className="h-7 w-7 text-[#E6231F]" />
        </div>

        <h1
          className="mb-3 text-lg font-extrabold tracking-wide text-[#FF6B60]"
          style={{ fontFamily: '"Anton", Battambang, Inter, sans-serif', letterSpacing: '0.03em' }}
        >
          Error — Copyright Content
        </h1>
        <p className="mb-2 text-sm leading-relaxed text-white/70">
          ការចូលប្រើមិនអាចធ្វើទៅបានទេ។ គណនីនេះត្រូវបានដាក់កម្រិត ដោយសារបញ្ហារំលោភសិទ្ធិអ្នកនិពន្ធ
          (Copyright) ។
        </p>
        <p className="text-xs leading-relaxed text-white/40">
          Access unavailable. This account has been restricted due to a copyright issue.
        </p>
      </div>
    </div>
  );
}
