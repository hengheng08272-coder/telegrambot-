import { supabase } from '@/lib/supabase/supabaseClient';
import { getCurrentTelegramUser } from '@/lib/telegram';
import { isCurrency, type Currency } from '@/lib/format';
import type { Show } from '@/lib/types';

// What a movie costs when nothing more specific has been set — the value
// a brand-new install starts at, and the last-resort fallback if the
// settings read fails. The live default lives in app_settings
// (`movie_price_default`) and each title may override it in
// shows.movie_price, so this number is only ever a floor under those two.
export const DEFAULT_MOVIE_PRICE = 1;

/** Kept under its old name for callers that only want "the usual price". */
export const MOVIE_PRICE = DEFAULT_MOVIE_PRICE;

const QR_TIER_KEY = 'movie'; // row key in payment_qr_codes — see QrCodesPanel

export interface MoviePricing {
  /** Applies to every movie whose own movie_price is null. */
  defaultPrice: number;
  currency: Currency;
}

export const FALLBACK_PRICING: MoviePricing = {
  defaultPrice: DEFAULT_MOVIE_PRICE,
  currency: 'USD',
};

/**
 * The catalog-wide price settings, read once per screen that shows a
 * price.
 *
 * Deliberately NOT what the purchase is charged at — create_movie_purchase
 * re-reads all of this server-side and writes its own number onto the
 * ticket. What comes back here is only what the viewer is shown, so a
 * stale or tampered value can mislead a price tag but can never change
 * what is actually owed.
 */
export async function fetchMoviePricing(): Promise<MoviePricing> {
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['movie_price_default', 'movie_currency']);
  const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const parsed = Number(map.get('movie_price_default'));
  const currency = map.get('movie_currency');
  return {
    defaultPrice: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MOVIE_PRICE,
    currency: isCurrency(currency) ? currency : 'USD',
  };
}

export async function saveMoviePricing(pricing: MoviePricing): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('app_settings').upsert([
    { key: 'movie_price_default', value: String(pricing.defaultPrice), updated_at: now },
    { key: 'movie_currency', value: pricing.currency, updated_at: now },
  ]);
  return { error: error?.message ?? null };
}

/** Sets (or clears, with null) one title's own price. */
export async function saveMoviePrice(
  showId: string,
  price: number | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('shows').update({ movie_price: price }).eq('id', showId);
  return { error: error?.message ?? null };
}

/** What this specific title costs today: its own price, else the default. */
export function priceOf(show: Pick<Show, 'movie_price'>, pricing: MoviePricing): number {
  const own = show.movie_price;
  return typeof own === 'number' && own > 0 ? own : pricing.defaultPrice;
}

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
  /** What the SERVER decided this ticket costs — the figure to put on the
   *  QR, rather than anything the client worked out for itself. */
  currency: Currency;
  submitted_at: string;
}

// The full set of show_ids this viewer already owns — App.tsx loads this
// once (alongside VIP status) so every screen can check
// `purchasedMovieIds.has(show.id)` with no extra round trip.
export async function getMyMoviePurchases(): Promise<Set<string>> {
  const { id } = getIdentity();
  const { data } = await supabase.rpc('get_my_movie_purchases', {
    p_telegram_user_id: id,
  });
  return new Set(((data ?? []) as { show_id: string }[]).map((row) => row.show_id));
}

export async function hasPurchasedMovie(showId: string): Promise<boolean> {
  const { id } = getIdentity();
  // Reuses the same scoped RPC as getMyMoviePurchases rather than adding
  // a second one for a question the first already answers.
  const { data } = await supabase.rpc('get_my_movie_purchases', {
    p_telegram_user_id: id,
  });
  return ((data ?? []) as { show_id: string }[]).some((row) => row.show_id === showId);
}

// A pending ticket for THIS show, if one is already open — so reopening
// the purchase modal resumes it instead of creating a duplicate.
export async function getPendingMoviePurchase(showId: string): Promise<MoviePurchase | null> {
  const { id } = getIdentity();
  const { data } = await supabase.rpc('get_my_pending_movie_purchase', {
    p_telegram_user_id: id,
    p_show_id: showId,
  });
  return (data as MoviePurchase[] | null)?.[0] ?? null;
}

// Opens a ticket the moment the viewer taps "Buy" — same "create first,
// attach proof after" shape as submitPaymentIntent, so the admin has
// something to match a bank notification against as soon as possible.
export async function submitMoviePurchaseIntent(
  showId: string,
): Promise<{ error: string | null; id: string | null }> {
  const { id, username } = getIdentity();
  // No amount is sent. create_movie_purchase reads the price off the show
  // (falling back to the catalog default) and writes that, so a caller
  // cannot open a one-cent ticket for a ten-dollar film and then have the
  // ABA ingest match the cent against it.
  const { data: newId, error } = await supabase.rpc('create_movie_purchase', {
    p_telegram_user_id: id,
    p_telegram_username: username,
    p_show_id: showId,
  });
  if (error) return { error: error.message, id: null };
  return { error: null, id: newId as string };
}

// Closes out a ticket whose window ran out, so the bank matcher can
// never attach a later, unrelated payment to a purchase the viewer
// walked away from. Mirrors expireStaleSubmission for VIP. Returns false
// when the row no longer qualifies — already decided, or a receipt was
// attached, in which case it is waiting on the admin, not on the payer.
export async function expireStaleMoviePurchase(purchaseId: string): Promise<boolean> {
  const { id } = getIdentity();
  const { data } = await supabase.rpc('expire_stale_movie_purchase', {
    p_purchase_id: purchaseId,
    p_telegram_user_id: id,
  });
  return data === true;
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
  const { data } = await supabase.rpc('get_my_movie_purchase_status', {
    p_telegram_user_id: getIdentity().id,
    p_purchase_id: id,
  });
  return (data as MoviePurchase['status'] | null) ?? null;
}

export async function getMovieQr(): Promise<{ imageUrl: string | null; khqrString: string | null }> {
  const { data } = await supabase
    .from('payment_qr_codes')
    .select('image_url, khqr_string')
    .eq('tier', QR_TIER_KEY)
    .maybeSingle();
  return { imageUrl: data?.image_url ?? null, khqrString: data?.khqr_string ?? null };
}
