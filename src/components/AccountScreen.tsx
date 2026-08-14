import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, Crown, Gift, ShieldCheck, Sparkles, User, FileText, Copy, Check } from 'lucide-react';
import { getCurrentTelegramProfile } from '@/lib/telegram';
import { getSubscriptionStatus, PRICING_TIERS, type SubscriptionStatus } from '@/lib/subscription';
import { getAvailableBonusSpin, type BonusSpinInfo } from '@/lib/spin';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import LanguageSwitcher from '@/components/LanguageSwitcher';

interface Props {
  onBack: () => void;
  onOpenWatchlist: () => void;
  onOpenSubscription: () => void;
  onOpenSpin: () => void;
  onOpenLegal: () => void;
  /** Fired when the watermark logo above the profile card is tapped 5
   *  times in quick succession — the hidden admin entry point, moved
   *  here from the home header so it lives on the account screen. */
  onAdminSecretTap?: () => void;
}

export default function AccountScreen({ onBack, onOpenWatchlist, onOpenSubscription, onOpenSpin, onOpenLegal, onAdminSecretTap }: Props) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [bonusInfo, setBonusInfo] = useState<BonusSpinInfo | null>(null);
  const [idCopied, setIdCopied] = useState(false);
  const profile = getCurrentTelegramProfile();
  const { lang, setLang } = useLang();
  const t = appText[lang];

  useEffect(() => {
    getSubscriptionStatus().then(setStatus);
    getAvailableBonusSpin().then(setBonusInfo);
  }, []);

  // Hidden admin entry point: 5 taps on the logo watermark within 2.5s
  // opens admin sign-in. Nothing else on mobile can reach it, since the
  // admin gate is desktop-only by design — this is the account-screen
  // home for that gesture (it used to live on the home header logo).
  const logoTapTimes = useRef<number[]>([]);
  const handleLogoTap = () => {
    const now = Date.now();
    logoTapTimes.current = [...logoTapTimes.current.filter((ts) => now - ts < 2500), now];
    if (logoTapTimes.current.length >= 5) {
      logoTapTimes.current = [];
      onAdminSecretTap?.();
    }
  };

  const tierLabel = status?.tier ? PRICING_TIERS.find((tier) => tier.key === status.tier)?.labelKm ?? status.tier : null;

  const daysLeft = status?.expiresAt
    ? Math.max(0, Math.ceil((new Date(status.expiresAt).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="min-h-screen bg-[#0A0A0D] pb-10 text-white">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <button onClick={onBack} className="text-white/70 transition hover:text-white" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-sm font-bold">គណនីរបស់ខ្ញុំ</h1>
      </div>

      <div className="px-4 py-6">
        {/* Logo watermark — sits above the profile card and doubles as the
            hidden admin entry point (5 taps within 2.5s), moved here from
            the home header so mobile still has a way in without a
            visible admin button anywhere in the app. */}
        <button
          onClick={handleLogoTap}
          aria-hidden="true"
          tabIndex={-1}
          className="mx-auto mb-4 block"
        >
          <img
            src="/assets/images/logo-transparent.png"
            alt=""
            draggable={false}
            className="mx-auto h-14 w-auto opacity-90 sm:h-16"
          />
        </button>

        {/* Identity — a wide "VIP card" style block (photo + name/handle
            side by side) instead of a stacked, centered column, echoing
            the horizontal hero-card treatment used for featured shows
            elsewhere in the app. The border/glow reflects VIP status
            directly (gold for active subscribers, quiet teal for
            guests), and it's the real Telegram photo + name, not a
            placeholder — sized and spaced for a phone screen first. */}
        <div
          className="relative mb-4 flex items-center gap-3 overflow-hidden rounded-2xl border p-3.5 sm:gap-4 sm:p-4"
          style={
            status?.subscribed
              ? {
                  borderColor: 'rgba(227,179,65,0.3)',
                  background:
                    'linear-gradient(120deg, rgba(227,179,65,0.14), rgba(10,10,13,0.4) 60%)',
                  boxShadow: '0 0 24px rgba(227,179,65,0.12)',
                }
              : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }
          }
        >
          {status?.subscribed && (
            <span
              className="absolute right-3 top-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#0A0A0D]"
              style={{ background: 'linear-gradient(135deg, #F0D9A0, #E3B341 45%, #B2882F)' }}
            >
              <Crown className="h-2.5 w-2.5" /> VIP
            </span>
          )}

          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full sm:h-[72px] sm:w-[72px]"
            style={
              status?.subscribed
                ? {
                    background: 'linear-gradient(135deg, #F0D9A0, #E3B341 45%, #B2882F)',
                    padding: 2,
                    boxShadow: '0 0 20px rgba(227,179,65,0.35)',
                  }
                : { background: 'rgba(43,92,173,0.35)', padding: 2 }
            }
          >
            <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#12302D] to-[#151A1A]">
              {profile?.photoUrl ? (
                <img src={profile.photoUrl} alt={profile.fullName ?? 'Profile'} className="h-full w-full object-cover" />
              ) : (
                <User className="h-7 w-7 text-white/60" />
              )}
            </div>
          </div>

          {/* Real Telegram identity (name + @username), not a generic
              placeholder — this is what makes "no separate account
              needed, you're already signed in as you" credible at a
              glance instead of just a claim in copy somewhere. */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-white sm:text-lg">
              {profile?.fullName ?? 'ភ្ញៀវ'}
            </p>
            {profile?.username && (
              <p className="truncate text-xs font-medium text-white/45">@{profile.username}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {status?.subscribed ? (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-[#E3B341]">
                  សមាជិក VIP
                </span>
              ) : (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/50">
                  មិនទាន់ជា VIP
                </span>
              )}
              {profile?.id && (
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(String(profile.id));
                      setIdCopied(true);
                      setTimeout(() => setIdCopied(false), 1500);
                    } catch {
                      /* clipboard unavailable — the ID is still visible to read/copy manually */
                    }
                  }}
                  className="flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/40 transition hover:bg-white/10 hover:text-white/70"
                  title="ចម្លង Telegram ID"
                >
                  ID: {profile.id}
                  {idCopied ? <Check className="h-2.5 w-2.5 text-[#34B37A]" /> : <Copy className="h-2.5 w-2.5" />}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* VIP status card — expiry is now the headline number (large,
            top of the card) instead of a small row buried in a list, since
            "when does my VIP run out" is the #1 thing people open this
            screen to check. */}
        {status?.subscribed ? (
          <div className="mb-4 overflow-hidden rounded-2xl border border-[#E3B341]/25 bg-gradient-to-br from-[#E3B341]/10 via-transparent to-[#2B5CAD]/5 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#E3B341]" />
              <p className="text-sm font-bold text-white">VIP កំពុងសកម្ម</p>
              {tierLabel && (
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/60">
                  {tierLabel}
                </span>
              )}
            </div>

            {status.expiresAt && (
              <div className="mb-3 rounded-xl border border-white/10 bg-black/25 p-3 text-center">
                <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">ផុតកំណត់</p>
                <p className="mt-0.5 text-xl font-black text-white">
                  {new Date(status.expiresAt).toLocaleDateString('km-KH', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
                {daysLeft !== null && (
                  <p className="mt-0.5 text-xs font-semibold text-[#2B5CAD]">នៅសល់ {daysLeft} ថ្ងៃ</p>
                )}
              </div>
            )}

            <button
              onClick={onOpenSubscription}
              className="w-full rounded-full border border-[#E3B341]/30 bg-[#E3B341]/10 py-2 text-xs font-bold text-[#E3B341] transition hover:bg-[#E3B341]/20"
            >
              បន្តគម្រោង / ប្តូរគម្រោង
            </button>
          </div>
        ) : (
          <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center">
            <p className="mb-3 text-sm text-white/60">ចុះឈ្មោះជា VIP ដើម្បីមើលគ្រប់វគ្គ + ចាប់រង្វាន់ bonus</p>
            <button
              onClick={onOpenSubscription}
              className="w-full rounded-full bg-gradient-to-r from-[#E6231F] to-[#7A0F0D] py-2.5 text-sm font-bold text-white transition"
            >
              ក្លាយជា VIP ឥឡូវនេះ
            </button>
          </div>
        )}

        {/* Bonus spin available — the actual mechanism: buying certain VIP
            plans unlocks one spin for bonus days on top of the plan
            (see BONUS_POOLS), it's a spin the person plays, not days
            added silently, so the copy says exactly that. */}
        {bonusInfo && (
          <button
            onClick={onOpenSpin}
            className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-[#2B5CAD]/30 bg-gradient-to-r from-[#2B5CAD]/10 to-transparent p-4 text-left transition hover:border-[#2B5CAD]/60"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E3B341] to-[#A9782E]">
              <Gift className="h-5 w-5 text-[#0A0A0D]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">មាន Bonus Spin រង់ចាំ!</p>
              <p className="text-xs text-white/50">ការទិញ VIP លើកនេះឲ្យអ្នកនូវការចាប់រង្វាន់ថ្ងៃបន្ថែម ១ដង — ចុចដើម្បីចាប់</p>
            </div>
            <Sparkles className="h-4 w-4 text-[#E3B341]" />
          </button>
        )}

        {/* Quick links — grouped into a single card with an internal
            divider (matches the identity/status card's radius + border
            treatment above) instead of two separate floating blocks, so
            the bottom of the screen reads as one settings list. */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          <button
            onClick={onOpenWatchlist}
            className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.06]"
          >
            <Bookmark className="h-5 w-5 text-white/50" />
            <span className="text-sm font-semibold text-white">បញ្ជីរបស់ខ្ញុំ</span>
          </button>

          <div className="h-px bg-white/10" />

          <button
            onClick={onOpenLegal}
            className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.06]"
          >
            <FileText className="h-5 w-5 text-white/50" />
            <span className="text-sm font-semibold text-white">លក្ខខណ្ឌប្រើប្រាស់ & ឯកជនភាព</span>
          </button>

          <div className="h-px bg-white/10" />

          <div className="flex items-center justify-between p-4">
            <span className="text-sm font-semibold text-white">{t.language}</span>
            <LanguageSwitcher lang={lang} onChange={setLang} />
          </div>
        </div>
      </div>
    </div>
  );
}
