import { useEffect, useState } from 'react';
import {
  Phone,
  User,
  Lock,
  Eye,
  EyeOff,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  Film,
  Smartphone,
  AlertTriangle,
} from 'lucide-react';
import {
  signUp,
  signIn,
  validatePhone,
  validatePassword,
} from '@/lib/auth';
import { fetchShowcaseShows } from '@/lib/api';
import type { Show } from '@/lib/types';
import { useLang } from '@/lib/useLang';
import { appText } from '@/lib/appTranslations';
import LanguageSwitcher from '@/components/LanguageSwitcher';

interface AuthScreenProps {
  mode: 'signin' | 'signup';
  onBack: () => void;
  onSuccess: () => void;
  onSwitch: (mode: 'signin' | 'signup') => void;
  kickedOut?: boolean;
}

export default function AuthScreen({
  mode,
  onBack,
  onSuccess,
  onSwitch,
  kickedOut,
}: AuthScreenProps) {
  const isSignUp = mode === 'signup';
  const { lang, setLang, isKm } = useLang();
  const t = appText[lang];

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shows, setShows] = useState<Show[]>([]);

  useEffect(() => {
    let active = true;
    fetchShowcaseShows(8)
      .then((data) => {
        if (active) setShows(data);
      })
      .catch(() => {
        if (active) setShows([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const backdrop = shows.find((s) => s.banner_url)?.banner_url ?? shows[0]?.poster_url ?? null;
  const strip = shows.slice(0, 8);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isSignUp && name.trim().length < 2) {
      setError('Please enter your name');
      return;
    }
    const phoneErr = validatePhone(phone);
    if (phoneErr) {
      setError(phoneErr);
      return;
    }
    const pwErr = validatePassword(password);
    if (pwErr) {
      setError(pwErr);
      return;
    }
    if (isSignUp && password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    const res = isSignUp
      ? await signUp({ name: name.trim(), phone, password })
      : await signIn({ phone, password });
    setLoading(false);

    if (res.error) {
      setError(res.error);
      return;
    }
    onSuccess();
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0A0A0F] text-white">
      {/* Big background bleed from the catalog's own art */}
      {backdrop && (
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-30 blur-3xl scale-125"
            style={{ backgroundImage: `url(${backdrop})` }}
          />
        </div>
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 12% -5%, rgba(201,122,46,0.22) 0%, rgba(10,10,15,0) 48%), radial-gradient(circle at 88% 105%, rgba(15,143,114,0.18) 0%, rgba(10,10,15,0) 52%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0A0A0F]/55 via-[#0A0A0F]/80 to-[#0A0A0F]" />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white/80 backdrop-blur-sm transition hover:bg-white/[0.08] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> {t.back}
          </button>
          <div className="flex items-center gap-2">
            <img
              src="/assets/images/logo-transparent.png"
              alt="NINT ANIME"
              className="h-8 w-8 drop-shadow-[0_0_14px_rgba(15,143,114,0.5)]"
            />
            <span
              className="text-lg font-black tracking-wider"
              style={{ fontFamily: '"Bebas Neue", "Battambang", Inter, sans-serif' }}
            >
              NINT ANIME
            </span>
          </div>
          <LanguageSwitcher lang={lang} onChange={setLang} />
        </div>

        {/* Glowing poster strip */}
        {strip.length > 0 && (
          <div
            className="flex justify-center gap-2 px-5 pt-2"
            style={{
              maskImage: 'linear-gradient(90deg, transparent, black 15%, black 85%, transparent)',
              WebkitMaskImage:
                'linear-gradient(90deg, transparent, black 15%, black 85%, transparent)',
            }}
          >
            {strip.map((show) => (
              <div
                key={show.id}
                className="relative aspect-[2/3] w-10 sm:w-12 flex-shrink-0 overflow-hidden rounded-lg border border-white/10 opacity-90 shadow-[0_8px_20px_rgba(0,0,0,0.5)]"
              >
                {show.poster_url ? (
                  <img src={show.poster_url} alt={show.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#14141C]">
                    <Film className="h-3.5 w-3.5 text-white/20" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Form card */}
        <div className="flex flex-1 items-center justify-center px-5 py-8">
          <div className="w-full max-w-md">
            {kickedOut && (
              <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[#EF4444]/30 bg-[#EF4444]/[0.08] p-4 text-left">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#EF4444]/15">
                  <AlertTriangle className="h-4 w-4 text-[#EF4444]" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{t.sessionKickedTitle}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/60">
                    {t.sessionKickedMessage}
                  </p>
                </div>
              </div>
            )}

            <div className="mb-7 text-center">
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-[#E8A94A]/25 bg-[#E8A94A]/[0.08] px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-[#E8A94A]">
                <ShieldCheck className="h-3 w-3" /> Premium Access
              </div>
              <h1
                className={`text-4xl font-black tracking-tight ${isKm ? 'font-khmer' : ''}`}
                style={{ fontFamily: '"Bebas Neue", "Battambang", Inter, sans-serif', letterSpacing: '0.03em' }}
              >
                {isSignUp ? t.createAccountTitle : t.welcomeBack}
              </h1>
              <p className="mt-2 text-sm text-white/50">
                {isSignUp ? t.signUpSubtitle : t.signInSubtitle}
              </p>
            </div>

            <div
              className="rounded-[26px] p-[1px] shadow-[0_30px_70px_rgba(0,0,0,0.55)]"
              style={{
                background:
                  'linear-gradient(160deg, rgba(255,210,120,0.35), rgba(255,255,255,0.06) 30%, rgba(15,143,114,0.18) 100%)',
              }}
            >
              <form
                onSubmit={handleSubmit}
                className="relative overflow-hidden rounded-[25px] border border-white/5 bg-[#111117]/90 p-6 backdrop-blur-xl"
              >
                {/* subtle top sheen */}
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-24"
                  style={{
                    background:
                      'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0) 100%)',
                  }}
                />
                {isSignUp && (
                  <Field
                    icon={<User className="h-5 w-5" />}
                    label={t.labelName}
                    type="text"
                    value={name}
                    onChange={setName}
                    placeholder={t.placeholderName}
                    autoComplete="name"
                  />
                )}

                <Field
                  icon={<Phone className="h-5 w-5" />}
                  label={t.labelPhone}
                  type="tel"
                  value={phone}
                  onChange={setPhone}
                  placeholder="e.g. +1 555 123 4567"
                  autoComplete="tel"
                />

                <Field
                  icon={<Lock className="h-5 w-5" />}
                  label={t.labelPassword}
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={setPassword}
                  placeholder={t.placeholderPassword}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      className="text-white/40 transition hover:text-white/70"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  }
                />

                {isSignUp && (
                  <Field
                    icon={<Lock className="h-5 w-5" />}
                    label={t.labelConfirmPassword}
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={setConfirm}
                    placeholder={t.placeholderConfirmPassword}
                    autoComplete="new-password"
                  />
                )}

                {error && (
                  <div className="mt-4 rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#EF4444]">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold text-black shadow-[0_10px_30px_rgba(201,122,46,0.3)] transition hover:shadow-[0_14px_40px_rgba(201,122,46,0.45)] active:scale-[0.98] disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #E8A94A, #FF9F3C)' }}
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <ShieldCheck className="h-5 w-5" />
                      {isSignUp ? t.createAccount : t.signIn}
                    </>
                  )}
                </button>

                <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[10.5px] leading-relaxed text-white/35">
                  <Smartphone className="h-3 w-3 flex-shrink-0" />
                  {t.oneDeviceNote}
                </p>
              </form>
            </div>

            <p className="mt-6 text-center text-sm text-white/50">
              {isSignUp ? t.haveAccount : t.noAccount}{' '}
              <button
                onClick={() => onSwitch(isSignUp ? 'signin' : 'signup')}
                className="font-semibold text-[#E8A94A] transition hover:text-[#F3CD82]"
              >
                {isSignUp ? t.switchToSignIn : t.switchToSignUp}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  icon: React.ReactNode;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  trailing?: React.ReactNode;
}

function Field({
  icon,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  trailing,
}: FieldProps) {
  return (
    <div className="mt-4 first:mt-0">
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/50">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-white/[0.05] text-white/45">
          {icon}
        </span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-12 pr-11 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#E8A94A]/50 focus:bg-white/[0.07] focus:shadow-[0_0_0_3px_rgba(232,169,74,0.12)]"
        />
        {trailing && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
            {trailing}
          </span>
        )}
      </div>
    </div>
  );
}
