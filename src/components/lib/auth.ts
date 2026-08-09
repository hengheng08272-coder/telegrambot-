import { supabase } from '@/lib/supabase/supabaseClient';

export interface Profile {
  id: string;
  display_name: string;
  phone: string | null;
  avatar_url: string | null;
  is_locked: boolean | null;
  is_admin: boolean;
  trial_started_at: string | null;
  subscription_expires_at: string | null;
  active_session_id?: string | null;
  active_session_started_at?: string | null;
  lucky_draw_used?: boolean;
}

export function isSubscribed(profile: Profile | null): boolean {
  if (!profile) return false;
  if (!profile.subscription_expires_at) return false;
  return new Date(profile.subscription_expires_at) > new Date();
}

// --- Single-device sign-in enforcement --------------------------------
//
// Every successful sign-in/sign-up writes a fresh random token to both
// profiles.active_session_id (server) and localStorage (this device). If a
// second device signs in to the same account, its write overwrites the
// server value; the first device's realtime subscription (see
// subscribeToSessionKick) notices the mismatch and signs itself out.

const SESSION_STORAGE_KEY = 'nint_session_id';

export function getLocalSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setLocalSessionId(id: string): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, id);
  } catch {
    /* localStorage unavailable — single-device enforcement is skipped */
  }
}

export function clearLocalSessionId(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

async function claimSession(userId: string): Promise<void> {
  const sessionId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setLocalSessionId(sessionId);
  await supabase
    .from('profiles')
    .update({
      active_session_id: sessionId,
      active_session_started_at: new Date().toISOString(),
    })
    .eq('id', userId);
}

// Subscribes to realtime changes on this user's profile row. Fires
// `onKicked()` the moment active_session_id changes to something other than
// this device's own token — i.e. another device just signed in. Returns an
// unsubscribe function.
export function subscribeToSessionKick(
  userId: string,
  onKicked: () => void,
): () => void {
  const channel = supabase
    .channel(`session-guard-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${userId}`,
      },
      (payload) => {
        const newSessionId = (payload.new as { active_session_id?: string | null })
          .active_session_id;
        const localId = getLocalSessionId();
        if (newSessionId && localId && newSessionId !== localId) {
          onKicked();
        }
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Subscribes to realtime changes on this user's profile row and calls
// `onChange` with the fresh row on every UPDATE — e.g. when an admin
// confirms a payment, the auto QR-confirm edge function unlocks the
// account, or claim_new_member_spin() extends subscription_expires_at.
// Lets the UI (VIP badge, lucky-draw prompt) react live without a reload.
export function subscribeToProfileChanges(
  userId: string,
  onChange: (profile: Profile) => void,
): () => void {
  const channel = supabase
    .channel(`profile-changes-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${userId}`,
      },
      (payload) => {
        onChange(payload.new as Profile);
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// One-shot check for cases where the realtime event was missed (e.g. tab was
// asleep/backgrounded). Call on app resume/focus.
export async function checkSessionStillValid(userId: string): Promise<boolean> {
  const localId = getLocalSessionId();
  if (!localId) return true; // nothing to compare against yet
  const { data } = await supabase
    .from('profiles')
    .select('active_session_id')
    .eq('id', userId)
    .maybeSingle();
  if (!data?.active_session_id) return true;
  return data.active_session_id === localId;
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
    phone: opts.phone,
    avatar_url: null,
  });
  if (profileError) return { error: profileError.message };
  await claimSession(user.id);
  return { error: null };
}

export async function signIn(opts: {
  phone: string;
  password: string;
}): Promise<{ error: string | null }> {
  const email = phoneToEmail(opts.phone);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: opts.password,
  });
  if (error) return { error: error.message };
  if (data.user) await claimSession(data.user.id);
  return { error: null };
}

export async function signOut(): Promise<void> {
  clearLocalSessionId();
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

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, phone, avatar_url, is_locked, is_admin, trial_started_at, subscription_expires_at, lucky_draw_used')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  return data as Profile | null;
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
