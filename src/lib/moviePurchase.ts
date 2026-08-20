import { supabase } from '@/lib/supabase/supabaseClient';
import { getCurrentTelegramUser } from '@/lib/telegram';

// Flat price for any standalone-purchasable movie. Not per-show — every
// movie that isn't marked is_free sells for the same $1, so there is no
// per-show price field to keep in sync.
export const MOVIE_PRICE = 1;
const QR_TIER_KEY = 'movie'; // row key in payment_qr_codes — see QrCodesPanel

function getIdentity() {
  const user = getCurrentTelegramUser();
  if (user) return { id: String(user.id), username: user.label };
  let deviceId = localStorage.getItem('nint_spin_device_id');
  if (!deviceId) {
    deviceId = `device_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('nint_spin_device_id', deviceId);
  }
  return { id: deviceId, username: null as string | null };
}

export interface MoviePurchase {
  id: string;
  show_id: string;
  status: 'pending' | 'approved' | 'rejected';
  amount: number;
  submitted_at: string;
}

// The full set of show_ids this viewer already owns — App.tsx loads this
// once (alongside VIP status) so every screen can check
// `purchasedMovieIds.has(show.id)` with no extra round trip.
export async function getMyMoviePurchases(): Promise<Set<string>> {
  const { id } = getIdentity();
  const { data } = await supabase
    .from('movie_purchases')
    .select('show_id')
    .eq('telegram_user_id', id)
    .eq('status', 'approved');
  return new Set((data ?? []).map((row) => row.show_id as string));
}

export async function hasPurchasedMovie(showId: string): Promise<boolean> {
  const { id } = getIdentity();
  const { data } = await supabase
    .from('movie_purchases')
    .select('id')
    .eq('telegram_user_id', id)
    .eq('show_id', showId)
    .eq('status', 'approved')
    .maybeSingle();
  return !!data;
}

// A pending ticket for THIS show, if one is already open — so reopening
// the purchase modal resumes it instead of creating a duplicate.
export async function getPendingMoviePurchase(showId: string): Promise<MoviePurchase | null> {
  const { id } = getIdentity();
  const { data } = await supabase
    .from('movie_purchases')
    .select('id, show_id, status, amount, submitted_at')
    .eq('telegram_user_id', id)
    .eq('show_id', showId)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .maybeSingle();
  return data ?? null;
}

// Opens a ticket the moment the viewer taps "Buy" — same "create first,
// attach proof after" shape as submitPaymentIntent, so the admin has
// something to match a bank notification against as soon as possible.
export async function submitMoviePurchaseIntent(
  showId: string,
): Promise<{ error: string | null; id: string | null }> {
  const { id, username } = getIdentity();
  const { data: inserted, error } = await supabase
    .from('movie_purchases')
    .insert({
      telegram_user_id: id,
      telegram_username: username,
      show_id: showId,
      amount: MOVIE_PRICE,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) return { error: error.message, id: null };
  return { error: null, id: inserted.id };
}

// Attaches the receipt and grants the unlock immediately (same
// optimistic-grant tradeoff as attachScreenshotToSubmission /
// confirm-payment-proof for VIP — see confirm-movie-payment-proof for
// why). The admin still gets the photo with Confirm/Revoke buttons for a
// retroactive check.
export async function attachMovieScreenshot(
  submissionId: string,
  screenshot: File,
): Promise<{ error: string | null }> {
  const { id } = getIdentity();
  const ext = screenshot.name.split('.').pop() || 'jpg';
  const path = `movie/${id}/${Date.now()}.${ext}`;
  const { error: uploadErr } = await supabase.storage
    .from('payment-proofs')
    .upload(path, screenshot, { contentType: screenshot.type });
  if (uploadErr) return { error: uploadErr.message };

  const { data: pub } = supabase.storage.from('payment-proofs').getPublicUrl(path);

  const { error: fnError } = await supabase.functions.invoke('confirm-movie-payment-proof', {
    body: { submission_id: submissionId, screenshot_url: pub.publicUrl },
  });
  if (fnError) return { error: fnError.message };
  return { error: null };
}

export async function checkMoviePurchaseStatus(id: string): Promise<MoviePurchase['status'] | null> {
  const { data } = await supabase.from('movie_purchases').select('status').eq('id', id).maybeSingle();
  return data?.status ?? null;
}

export async function getMovieQr(): Promise<{ imageUrl: string | null; khqrString: string | null }> {
  const { data } = await supabase
    .from('payment_qr_codes')
    .select('image_url, khqr_string')
    .eq('tier', QR_TIER_KEY)
    .maybeSingle();
  return { imageUrl: data?.image_url ?? null, khqrString: data?.khqr_string ?? null };
}
