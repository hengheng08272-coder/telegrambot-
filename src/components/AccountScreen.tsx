import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  CalendarClock,
  Check,
  Copy,
  Crown,
  FileText,
  Gift,
  ShieldCheck,
  Sparkles,
  Tag,
  User,
  UserPlus,
} from 'lucide-react';
import { getCurrentTelegramProfile, shareReferralLink } from '@/lib/telegram';
import {
  getEffectivePricingTiers,
  getSubscriptionDetail,
  type PricingTier,
  type SubscriptionDetail,
} from '@/lib/subscription';
import { getAvailableBonusSpin, type BonusSpinInfo } from '@/lib/spin';
import { getReferralStats, type ReferralStats } from '@/lib/referral';
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
  const [status, setStatus] = useState<SubscriptionDetail | null>(null);
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [bonusInfo, setBonusInfo] = useState<BonusSpinInfo | null>(null);
  const [idCopied, setIdCopied] = useState(false);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [inviteState, setInviteState] = useState<'idle' | 'sent'>('idle');
  const profile = getCurrentTelegramProfile();
  const { lang, setLang } = useLang();
  const t = appText[lang];

  useEffect(() => {
    getSubscriptionDetail().then(setStatus);
    getEffectivePricingTiers().then(setTiers);
    getAvailableBonusSpin().then(setBonusInfo);
    getReferralStats().then(setReferralStats);
  }, []);

  const handleInviteReferral = async () => {
    const result = await shareReferralLink();
    if (result === 'shared' || result === 'copied') {
      setInviteState('sent');
      window.setTimeout(() => setInviteState('idle'), 2000);
    }
  };

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

  // Read the plan off the LIVE pricing_tiers rows, not the hardcoded
  // seed list. A plan slot can be re-priced or re-purposed by the admin
  // (the '2m' slot currently sells 3 months), and the code default goes
  // stale the moment that happens — so reading it from code would name
  // someone's plan wrongly on the one screen they open to check it.
  const currentTier = status?.tier ? tiers.find((tier) => tier.key === status.tier) ?? null : null;
  const tierLabel = currentTier?.labelKm ?? status?.tier ?? null;

  const daysLeft = status?.expiresAt
    ? Math.max(0, Math.ceil((new Date(status.expiresAt).getTime() - Date.now()) / 86_400_000))
    : null;

  // How far through the current period they are. `startedAt` is when VIP
  // time was last added, so this is honest even after an extension or a
  // bonus-spin top-up, without needing a separate start column.
  const totalDays =
    status?.startedAt && status?.expiresAt
      ? Math.max(
          1,
          Math.round(
            (new Date(status.expiresAt).getTime() - new Date(status.startedAt).getTime()) / 86_400_000,
          ),
        )
      : null;
  const usedPercent =
    totalDays !== null && daysLeft !== null
      ? Math.min(100, Math.max(0, ((totalDays - daysLeft) / totalDays) * 100))
      : null;
  // Expiry inside a week is the point where a reminder is useful rather
  // than nagging — before that the number alone is enough.
  const expiringSoon = daysLeft !== null && daysLeft <= 7;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'km' ? 'km-KH' : 'en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  return (
    <div className="min-h-screen bg-app pb-10 text-white">
      <div
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bar-blur px-4 py-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/80 transition hover:bg-white/[0.12] hover:text-white"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-sm font-bold">គណនីរបស់ខ្ញុំ</h1>
      </div>

      <div className="px-4 py-6 fade-up">
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
          className={`relative mb-4 flex items-center gap-3 overflow-hidden rounded-card border p-3.5 shadow-card sm:gap-4 sm:p-4 ${
            status?.subscribed ? 'gold-frame' : ''
          }`}
          style={
            status?.subscribed
              ? {
                  borderColor: 'rgba(245,197,99,0.3)',
                  background:
                    'linear-gradient(120deg, rgba(245,197,99,0.14), rgba(10,16,30,0.4) 60%)',
                  boxShadow: '0 0 24px rgba(245,197,99,0.12)',
                }
              : { borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }
          }
        >
          {status?.subscribed && (
            <span
              className="absolute right-3 top-3 flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#0A101E]"
              style={{ background: 'linear-gradient(135deg, #FFE7B0, #E6231F 45%, #C08F33)' }}
            >
              <Crown className="h-2.5 w-2.5" /> VIP
            </span>
          )}

          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full sm:h-[72px] sm:w-[72px]"
            style={
              status?.subscribed
                ? {
                    background: 'linear-gradient(135deg, #FFE7B0, #E6231F 45%, #C08F33)',
                    padding: 2,
                    boxShadow: '0 0 20px rgba(245,197,99,0.35)',
                  }
                : { background: 'rgba(76,111,255,0.35)', padding: 2 }
            }
          >
            <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#12302D] to-[#151A1A]">
              {profile?.photoUrl ? (
                <img src={profile.photoUrl} alt={profile.fullName ?? 'Profile'} className="h-full w-full object-cover" />
              ) : (
                <User className="h-7 w-7 text-[#B7C0D4]" />
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
              <p className="truncate text-xs font-medium text-[#9AA1B2]">@{profile.username}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {status?.subscribed ? (
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-[#E6231F]">
                  សមាជិក VIP
                </span>
              ) : (
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-medium text-[#A3ADC4]">
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
                  className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-medium text-[#8A93AC] transition hover:bg-white/10 hover:text-white/70"
                  title="ចម្លង Telegram ID"
                >
                  ID: {profile.id}
                  {idCopied ? <Check className="h-2.5 w-2.5 text-[#2FD98C]" /> : <Copy className="h-2.5 w-2.5" />}
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
          <div className="mb-4 overflow-hidden rounded-card border border-[#E6231F]/25 bg-gradient-to-br from-[#E6231F]/12 via-transparent to-[#4C6FFF]/8 p-4 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#E6231F]" />
              <p className="text-sm font-bold text-white">VIP កំពុងសកម្ម</p>
              {tierLabel && (
                <span className="ml-auto rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-[#B7C0D4]">
                  {tierLabel}
                </span>
              )}
            </div>

            {/* Days left is the headline, with the period bar under it —
                a bare date answers "when" but not "how much is left of
                what I bought", which is the thing people are actually
                checking for. */}
            <div className="mb-3 rounded-xl border border-white/10 bg-black/30 p-4 text-center">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#8A93AC]">នៅសល់</p>
              <p
                className={`text-4xl font-black leading-none ${
                  expiringSoon ? 'text-[#FFC24D]' : 'text-white'
                }`}
              >
                {daysLeft ?? '—'}
                <span className="ml-1 text-base font-bold text-[#A3ADC4]">ថ្ងៃ</span>
              </p>

              {usedPercent !== null && (
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${100 - usedPercent}%`,
                        background: expiringSoon
                          ? 'linear-gradient(90deg,#FFC24D,#E6231F)'
                          : 'linear-gradient(90deg,#E6231F,#86EEC0)',
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-white/35">
                    ប្រើទៅ {Math.round(usedPercent)}% នៃ {totalDays} ថ្ងៃ
                  </p>
                </div>
              )}

              {expiringSoon && (
                <p className="mt-2 text-[11px] font-semibold text-[#FFC24D]">
                  ជិតផុតកំណត់ហើយ — បន្តឥឡូវដើម្បីកុំឲ្យដាច់
                </p>
              )}
            </div>

            {/* The plan's own facts: which plan, how long it grants, and
                the exact start/end dates of the period being counted. */}
            <div className="mb-3 space-y-px overflow-hidden rounded-xl border border-white/10 bg-black/20">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <Tag className="h-3.5 w-3.5 shrink-0 text-white/35" />
                <span className="text-[11px] text-[#9AA1B2]">គម្រោង</span>
                <span className="ml-auto truncate text-xs font-semibold text-white">
                  {tierLabel ?? '—'}
                  {currentTier && (
                    <span className="text-[#8A93AC]"> · {currentTier.months} ខែ · ${currentTier.price}</span>
                  )}
                </span>
              </div>
              {status.startedAt && (
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0 text-white/35" />
                  <span className="text-[11px] text-[#9AA1B2]">ចាប់ផ្ដើម</span>
                  <span className="ml-auto text-xs font-semibold text-white">{fmtDate(status.startedAt)}</span>
                </div>
              )}
              {status.expiresAt && (
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0 text-[#E6231F]" />
                  <span className="text-[11px] text-[#9AA1B2]">ផុតកំណត់</span>
                  <span className="ml-auto text-xs font-semibold text-[#E6231F]">
                    {fmtDate(status.expiresAt)}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={onOpenSubscription}
              className="w-full rounded-full border border-[#E6231F]/30 bg-[#E6231F]/10 py-2 text-xs font-bold text-[#E6231F] transition hover:bg-[#E6231F]/20"
            >
              បន្តគម្រោង / ប្តូរគម្រោង
            </button>
          </div>
        ) : (
          <div className="card-surface mb-4 rounded-card p-4 text-center">
            <p className="mb-3 text-sm text-[#B7C0D4]">ចុះឈ្មោះជា VIP ដើម្បីមើលគ្រប់វគ្គ + ចាប់រង្វាន់ bonus</p>
            {/* The door and the room behind it are the same colour: this
                opens the checkout, which is red throughout. A teal CTA
                here handed off to a red sheet, and the two read as two
                different products. */}
            <button
              onClick={onOpenSubscription}
              className="co-btn co-btn-primary w-full rounded-full py-2.5 text-sm"
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
            className="mb-4 flex w-full items-center gap-3 rounded-card border border-[#4C6FFF]/30 bg-gradient-to-r from-[#4C6FFF]/12 to-transparent p-4 text-left shadow-card transition hover:border-[#4C6FFF]/60 hover:from-[#4C6FFF]/20 active:scale-[0.99]"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E6231F] to-[#B98430]">
              <Gift className="h-5 w-5 text-[#0A101E]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">មាន Bonus Spin រង់ចាំ!</p>
              <p className="text-xs text-[#A3ADC4]">ការទិញ VIP លើកនេះឲ្យអ្នកនូវការចាប់រង្វាន់ថ្ងៃបន្ថែម ១ដង — ចុចដើម្បីចាប់</p>
            </div>
            <Sparkles className="h-4 w-4 text-[#E6231F]" />
          </button>
        )}

        {/* Invite & Earn — the referral growth loop that replaces the old
            "must join the group" gate: sharing this viewer's personal
            link tags whoever opens it as referred by them (App.tsx +
            lib/referral.ts), and the moment that friend's first VIP
            payment is approved, this viewer's own subscription is
            extended automatically (see telegram-admin-bot/index.ts).
            Shows a running count so the reward feels real, not just a
            promise in copy. */}
        <button
          onClick={handleInviteReferral}
          className="mb-4 flex w-full items-center gap-3 rounded-card border border-[#E6231F]/25 bg-gradient-to-r from-[#E6231F]/12 to-transparent p-4 text-left shadow-card transition hover:border-[#E6231F]/50 hover:from-[#E6231F]/20 active:scale-[0.99]"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E6231F] to-[#8F1020]">
            <UserPlus className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">អញ្ជើញមិត្តភ័ក្តិ ទទួល VIP ឥតគិតថ្លៃ</p>
            <p className="text-xs text-[#A3ADC4]">
              {referralStats && referralStats.totalReferred > 0
                ? `មិត្តភ័ក្តិ ${referralStats.totalReferred} នាក់បានចូល • ទទួលបានរង្វាន់ ${referralStats.totalBonusDays} ថ្ងៃ`
                : 'ចែករំលែក link ផ្ទាល់ខ្លួន — មិត្តភ័ក្តិទិញ VIP លើកដំបូង អ្នកទទួលបានថ្ងៃ VIP ដោយឥតគិតថ្លៃ'}
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white/70">
            {inviteState === 'sent' ? 'បានផ្ញើ!' : 'ចែករំលែក'}
          </span>
        </button>

        {/* Quick links — grouped into a single card with an internal
            divider (matches the identity/status card's radius + border
            treatment above) instead of two separate floating blocks, so
            the bottom of the screen reads as one settings list. */}
        <div className="card-surface overflow-hidden rounded-card">
          <button
            onClick={onOpenWatchlist}
            className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.06]"
          >
            <Bookmark className="h-5 w-5 text-[#A3ADC4]" />
            <span className="text-sm font-semibold text-white">បញ្ជីរបស់ខ្ញុំ</span>
          </button>

          <div className="h-px bg-white/10" />

          <button
            onClick={onOpenLegal}
            className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-white/[0.06]"
          >
            <FileText className="h-5 w-5 text-[#A3ADC4]" />
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
