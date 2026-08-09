import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Loader2,
  LogOut,
  Check,
  User as UserIcon,
  Phone,
  Edit3,
  Settings,
  ChevronRight,
  Crown,
  Calendar,
  KeyRound,
  Send,
  Info,
  Plus,
  Minus,
  Eye,
  EyeOff,
  Smartphone,
} from 'lucide-react';
import type { Profile } from '@/lib/auth';
import {
  fetchProfile,
  updateProfile,
  uploadAvatar,
  signOut,
  changePassword,
  isSubscribed,
} from '@/lib/auth';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import LanguageSwitcher from '@/components/LanguageSwitcher';

// TODO: replace with the real support chat link once it's ready.
const TELEGRAM_SUPPORT_LINK = 'https://t.me/';
const APP_VERSION = '1.0.0';

interface ProfileScreenProps {
  userId: string;
  onBack: () => void;
  onSignOut: () => void;
  onOpenAdmin: () => void;
  onOpenSubscription: () => void;
}

export default function ProfileScreen({
  userId,
  onBack,
  onSignOut,
  onOpenAdmin,
  onOpenSubscription,
}: ProfileScreenProps) {
  const { lang, setLang } = useLang();
  const t = appText[lang];
  const fileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Change password
  const [showPwSection, setShowPwSection] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  // About us accordion
  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const p = await fetchProfile(userId);
      if (!active) return;
      setProfile(p);
      setName(p?.display_name ?? '');
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setError(null);
    setUploading(true);
    const { url, error: upErr } = await uploadAvatar(userId, file);
    setUploading(false);
    if (upErr || !url) {
      setError(upErr ?? 'Upload failed');
      return;
    }
    await updateProfile(userId, { avatar_url: url });
    setProfile({ ...profile, avatar_url: url });
  };

  const handleSave = async () => {
    if (!profile) return;
    setError(null);
    setSaving(true);
    const { error: e } = await updateProfile(userId, {
      display_name: name.trim(),
    });
    setSaving(false);
    if (e) {
      setError(e);
      return;
    }
    setProfile({ ...profile, display_name: name.trim() });
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSignOut = async () => {
    await signOut();
    onSignOut();
  };

  const handleChangePassword = async () => {
    setPwError(null);
    if (newPw !== confirmPw) {
      setPwError(t.newPasswordMismatch);
      return;
    }
    setPwSaving(true);
    const { error: e } = await changePassword(newPw);
    setPwSaving(false);
    if (e) {
      setPwError(e);
      return;
    }
    setNewPw('');
    setConfirmPw('');
    setPwSaved(true);
    setTimeout(() => setPwSaved(false), 2500);
  };

  const expiresAt = profile?.subscription_expires_at
    ? new Date(profile.subscription_expires_at)
    : null;
  const subscribed = isSubscribed(profile);
  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  const formattedExpiry = expiresAt
    ? expiresAt.toLocaleDateString(lang === 'km' ? 'km-KH' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0F]">
        <Loader2 className="h-8 w-8 animate-spin text-[#0F8F72]" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0A0A0F] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 20% 0%, rgba(15,143,114,0.15) 0%, rgba(10,10,15,0) 45%)',
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 backdrop-blur-sm transition hover:bg-white/[0.08] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> {t.back}
          </button>
          <h1
            className="text-xl font-black tracking-wider"
            style={{ fontFamily: '"Bebas Neue", "Battambang", Inter, sans-serif' }}
          >
            {t.myProfile}
          </h1>
          <div className="flex items-center gap-2">
            <LanguageSwitcher lang={lang} onChange={setLang} className="hidden sm:flex" />
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 backdrop-blur-sm transition hover:border-[#EF4444]/40 hover:text-[#EF4444]"
            >
              <LogOut className="h-4 w-4" /> {t.signOut}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="mx-auto w-full max-w-lg flex-1 px-5 py-8">
          {/* Avatar */}
          <div className="flex flex-col items-center">
            <div className="relative">
              <div className="h-32 w-32 overflow-hidden rounded-full border-2 border-white/10 bg-[#1E1E2A] shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="Avatar"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0F8F72] to-[#0B6E58]">
                    <span
                      className="text-5xl font-black text-white"
                      style={{ fontFamily: '"Bebas Neue", Battambang, Inter, sans-serif' }}
                    >
                      {(profile?.display_name || 'A').charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute bottom-1 right-1 flex h-10 w-10 items-center justify-center rounded-full bg-[#0F8F72] text-white shadow-lg ring-4 ring-[#0A0A0F] transition hover:bg-[#0B6E58] active:scale-95 disabled:opacity-60"
                aria-label="Change avatar"
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5" />
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleAvatar}
                className="hidden"
              />
            </div>
            <p className="mt-3 text-xs text-white/40">{t.changePhotoHint}</p>
          </div>

          {/* Info */}
          <div className="mt-10 space-y-4">
            {/* Name (editable) */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/50">
                <UserIcon className="h-4 w-4" /> {t.name}
              </div>
              {editing ? (
                <div className="flex items-center gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-[#0F8F72]/50"
                    autoFocus
                  />
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1 rounded-lg bg-[#0F8F72] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#0B6E58] disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {t.save}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <span className="text-base font-semibold text-white">
                    {profile?.display_name || '—'}
                  </span>
                  <button
                    onClick={() => setEditing(true)}
                    className="text-white/40 transition hover:text-[#0F8F72]"
                    aria-label="Edit name"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                </div>
              )}
              {saved && (
                <p className="mt-2 text-xs text-[#22C55E]">{t.nameUpdated}</p>
              )}
            </div>

            {/* Phone (read-only) */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/50">
                <Phone className="h-4 w-4" /> {t.phone}
              </div>
              <span className="text-base font-semibold text-white">
                {profile?.phone || '—'}
              </span>
            </div>

            {/* Membership / expiry status */}
            <div
              className="overflow-hidden rounded-2xl p-4"
              style={{
                border: subscribed
                  ? '1px solid rgba(232,169,74,0.3)'
                  : '1px solid rgba(255,255,255,0.1)',
                background: subscribed
                  ? 'linear-gradient(160deg, rgba(232,169,74,0.1) 0%, rgba(15,143,114,0.05) 100%)'
                  : 'rgba(255,255,255,0.03)',
              }}
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/50">
                <Crown className="h-4 w-4" /> {t.membershipStatus}
              </div>
              {subscribed ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <Crown size={15} className="text-[#E8A94A]" fill="#E8A94A" strokeWidth={0} />
                    <span className="text-base font-bold text-white">{t.premiumActive}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-white/60">
                    <Calendar className="h-3.5 w-3.5" />
                    {t.premiumUntil}: <span className="font-semibold text-white/85">{formattedExpiry}</span>
                  </div>
                  {daysLeft !== null && (
                    <p className="mt-1 text-xs text-white/40">
                      {daysLeft} {t.daysRemaining}
                    </p>
                  )}
                  <button
                    onClick={onOpenSubscription}
                    className="mt-3 rounded-xl px-4 py-2 text-xs font-bold text-black transition hover:opacity-90"
                    style={{ background: 'linear-gradient(90deg,#E8A94A,#C97A2E)' }}
                  >
                    {t.renewNow}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-white/70">{t.noActiveSubscription}</p>
                  <button
                    onClick={onOpenSubscription}
                    className="mt-3 flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-black transition hover:opacity-90"
                    style={{ background: 'linear-gradient(90deg,#E8A94A,#C97A2E)' }}
                  >
                    <Crown className="h-3.5 w-3.5" />
                    {t.getPremium}
                  </button>
                </>
              )}
            </div>

            {/* Change password */}
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <button
                onClick={() => setShowPwSection((s) => !s)}
                className="flex w-full items-center gap-3 p-4 text-left"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05]">
                  <KeyRound className="h-4 w-4 text-white/70" />
                </div>
                <span className="flex-1 text-sm font-bold text-white">{t.changePassword}</span>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5">
                  {showPwSection ? (
                    <Minus size={14} className="text-white" />
                  ) : (
                    <Plus size={14} className="text-white" />
                  )}
                </span>
              </button>
              {showPwSection && (
                <div
                  className="space-y-2.5 p-4"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      placeholder={t.newPassword}
                      className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 pr-10 text-sm text-white outline-none focus:border-[#E8A94A]/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    placeholder={t.confirmNewPasswordLabel}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none focus:border-[#E8A94A]/50"
                  />
                  {pwError && <p className="text-xs text-[#EF4444]">{pwError}</p>}
                  {pwSaved && <p className="text-xs text-[#22C55E]">{t.passwordUpdated}</p>}
                  <button
                    onClick={handleChangePassword}
                    disabled={pwSaving || !newPw || !confirmPw}
                    className="w-full rounded-xl bg-[#22C55E] py-2.5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {pwSaving ? t.updatingPassword : t.updatePassword}
                  </button>
                </div>
              )}
            </div>

            {/* Telegram support */}
            <a
              href={TELEGRAM_SUPPORT_LINK}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-[#29A9EA]/30 hover:bg-white/[0.05]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#29A9EA]/15">
                <Send className="h-5 w-5 text-[#29A9EA]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-white">{t.telegramSupport}</p>
                <p className="text-xs text-white/50">{t.telegramSupportSubtitle}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-white/30" />
            </a>

            {/* About us */}
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <button
                onClick={() => setShowAbout((s) => !s)}
                className="flex w-full items-center gap-3 p-4 text-left"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05]">
                  <Info className="h-5 w-5 text-white/70" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">{t.aboutUs}</p>
                  <p className="text-xs text-white/50">{t.aboutUsSubtitle}</p>
                </div>
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5">
                  {showAbout ? (
                    <Minus size={14} className="text-white" />
                  ) : (
                    <Plus size={14} className="text-white" />
                  )}
                </span>
              </button>
              {showAbout && (
                <div
                  className="space-y-3 p-4 pt-3"
                  style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <p className="text-sm leading-relaxed text-white/60">{t.aboutUsBody}</p>
                  <div className="flex items-center justify-between text-xs text-white/40">
                    <span>{t.appVersion}</span>
                    <span className="font-semibold text-white/60">{APP_VERSION}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-white/40">
                    <span>{t.contactUs}</span>
                    <a
                      href={TELEGRAM_SUPPORT_LINK}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 font-semibold text-[#29A9EA] hover:underline"
                    >
                      <Send className="h-3 w-3" /> Telegram
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Security note */}
            <div className="flex items-center gap-2 px-1 text-[11px] text-white/30">
              <Smartphone className="h-3.5 w-3.5 flex-shrink-0" />
              {t.oneDeviceNote}
            </div>
          </div>

          {/* Admin link — only visible to admins; the real enforcement is the
              admin-only RLS policies on episodes/videos, this just keeps the
              entry point out of view for everyone else. */}
          {profile?.is_admin && (
          <button
            onClick={onOpenAdmin}
            className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-[#0F8F72]/30 hover:bg-white/[0.05]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F8F72]/15">
              <Settings className="h-5 w-5 text-[#0F8F72]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-white">{t.videoManagement}</p>
              <p className="text-xs text-white/50">{t.videoManagementSubtitle}</p>
            </div>
            <ChevronRight className="h-5 w-5 text-white/30" />
          </button>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#EF4444]">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
