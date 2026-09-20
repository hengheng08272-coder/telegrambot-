import { supabase } from '@/lib/supabase/supabaseClient';
import { getTelegramInitData } from '@/lib/telegram';

export interface Profile {
  id: string;
  is_admin: boolean;
  /** Which level this session was minted at. `is_admin` decides whether
   *  the panel opens at all; this decides how much of it is live. */
  admin_role?: 'admin' | 'super_admin' | null;
  display_name?: string | null;
  avatar_url?: string | null;
}

// Convert a phone number into a fake email so Supabase email auth can be used
// as a phone-based login. The password is the real secret; the email is a
// deterministic placeholder derived from the digits.
//
// NOTE: this intentionally uses gmail.com as the domain, not a project-owned
// domain like nintanime.app. Supabase Auth validates that the email's domain
// has real DNS/MX records before accepting a signup — a domain with no mail
// server configured (like an app-only domain with nothing but a web host)
// gets rejected with "Email address ... is invalid" even though the format
// is fine. Since email confirmation is OFF, no mail is ever actually sent to
// these addresses, so borrowing a domain that's guaranteed to have valid MX
// records is a safe, standard workaround — it never collides with a real
// Gmail account because Supabase Auth users are scoped to this project only.
export function phoneToEmail(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `${digits}@gmail.com`;
}

export function validatePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return 'Enter a valid phone number';
  return null;
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 6) return 'Password must be at least 6 characters';
  return null;
}

// This is only ever used to create the admin account (desktop-only login,
// one person) — there's no viewer signup in this build, and no single-
// device-session enforcement, since that only matters when many people
// might share one account.
export async function signUp(opts: {
  name: string;
  phone: string;
  password: string;
}): Promise<{ error: string | null }> {
  const email = phoneToEmail(opts.phone);
  const { data, error } = await supabase.auth.signUp({
    email,
    password: opts.password,
  });
  if (error) return { error: error.message };
  const user = data.user;
  if (!user) return { error: 'Sign-up failed. Please try again.' };

  const { error: profileError } = await supabase.from('profiles').insert({
    id: user.id,
    display_name: opts.name,
  });
  if (profileError) return { error: profileError.message };
  return { error: null };
}

export async function signIn(opts: {
  phone: string;
  password: string;
}): Promise<{ error: string | null }> {
  const email = phoneToEmail(opts.phone);
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: opts.password,
  });
  if (error) return { error: error.message };
  return { error: null };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function changePassword(
  newPassword: string,
): Promise<{ error: string | null }> {
  const pwErr = validatePassword(newPassword);
  if (pwErr) return { error: pwErr };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error: error?.message ?? null };
}

// Only selects columns this build actually relies on (is_admin) plus a
// couple of optional display fields — never assumes the table has columns
// from the old app's schema (phone, session tracking, subscription, etc.),
// since a mismatch there is a silent 400 that blocks admin login entirely.
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, is_admin, admin_role')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  return data as Profile | null;
}

/**
 * Signs an administrator in from Telegram, with no password.
 *
 * The browser cannot be trusted to say who it is — getIdentity() reads
 * the Telegram user client-side, and the anon key is in the bundle, so
 * anyone could claim the owner's id. What IS trustworthy is the signed
 * `initData` string Telegram puts in the WebApp: the edge function
 * checks its HMAC against the bot token (which never reaches the
 * browser), looks the verified id up in admin_users, and only then
 * hands back a one-shot token. Everything here is worthless without
 * that signature.
 *
 * Returns the role on success, or null for "not an administrator",
 * which is the ordinary case for every viewer and is not an error.
 */
export async function signInWithTelegram(): Promise<'admin' | 'super_admin' | null> {
  const initData = getTelegramInitData();
  if (!initData) return null;
  try {
    const { data, error } = await supabase.functions.invoke('telegram-admin-session', {
      body: { initData },
    });
    if (error || !data?.token_hash) return null;
    // Exchanges the one-shot token for a real session. onAuthStateChange
    // in App.tsx picks it up and loads the profile from there.
    const { error: otpErr } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash as string,
      type: 'magiclink',
    });
    if (otpErr) return null;
    return (data.role as 'admin' | 'super_admin') ?? null;
  } catch {
    return null;
  }
}

export async function uploadAvatar(
  userId: string,
  file: File,
): Promise<{ url: string | null; error: string | null }> {
  const ext = file.name.split('.').pop() || 'png';
  const path = `${userId}/avatar.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return { url: null, error: upErr.message };
  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  return { url: pub.publicUrl, error: null };
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, 'display_name' | 'avatar_url'>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId);
  return { error: error?.message ?? null };
}
