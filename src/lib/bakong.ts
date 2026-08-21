import { supabase } from '@/lib/supabase/supabaseClient';

// =====================================================================
// Bakong KHQR — generate this app's own payment QR
//
// Until now every tier showed a STATIC QR image the admin uploaded, and
// whatever merchant name happened to be baked into that picture is what
// the payer saw in their banking app. That is the wrong way round: the
// name a member sees at the moment they hand over money is exactly what
// tells them they are paying the right people.
//
// The KHQR standard (EMVCo TLV, run in Cambodia by the NBC's Bakong) puts
// the merchant name and the receiving account inside the payload itself,
// so a QR generated here carries this app's own name. Two more things
// come for free from generating per payment instead of reusing a picture:
//
//   * the amount is baked in per tier, so the payer cannot under- or
//     overpay by mistake and the auto-confirm has an exact figure;
//   * every QR carries the ticket id as its bill number and an expiry
//     matching the 3-minute payment window, so one QR belongs to exactly
//     one payment attempt.
//
// The SDK (bakong-khqr, published by the NBC) and the QR encoder are both
// pulled in with dynamic import() — they are only needed while somebody
// is actually paying, so they stay out of the main bundle, the same way
// the player loads hls.js.
//
// IMPORTANT: the money lands in whatever `accountId` is configured here.
// The merchant NAME is only a label carried by the payload; it does not
// move funds. Both belong to the owner, and both are set in the admin
// panel — nothing about this file assumes a particular account.
// =====================================================================

export interface BakongConfig {
  /** Bakong account id, e.g. `nintanime@aba`. This is who gets paid. */
  accountId: string;
  /** Name the payer sees in their banking app, e.g. `NINT ANIME`. */
  merchantName: string;
  /** Merchant city, required by the KHQR spec, e.g. `Phnom Penh`. */
  city: string;
}

const SETTING_KEYS = {
  accountId: 'bakong_account_id',
  merchantName: 'bakong_merchant_name',
  city: 'bakong_city',
} as const;

/**
 * Reads the owner's Bakong details. Returns null when they haven't been
 * filled in, which is what keeps the uploaded-image path working for
 * anyone who never configures this.
 */
export async function fetchBakongConfig(): Promise<BakongConfig | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', [SETTING_KEYS.accountId, SETTING_KEYS.merchantName, SETTING_KEYS.city]);
  // The table/rows may not exist on older deploys — treat that as "not
  // configured" rather than an error, exactly like fetchTickerMessage.
  if (error || !data) return null;

  const map = new Map(data.map((row) => [row.key as string, row.value as string]));
  const accountId = (map.get(SETTING_KEYS.accountId) ?? '').trim();
  const merchantName = (map.get(SETTING_KEYS.merchantName) ?? '').trim();
  // City is the one field with a sane default: the spec requires it, but
  // asking an owner to think about it adds nothing.
  const city = (map.get(SETTING_KEYS.city) ?? '').trim() || 'Phnom Penh';

  // An account id without a name (or the reverse) would produce a QR that
  // either pays the wrong place or shows nothing recognisable, so both
  // have to be present before this path turns on at all.
  if (!accountId || !merchantName) return null;
  return { accountId, merchantName, city };
}

export async function saveBakongConfig(config: BakongConfig): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('app_settings').upsert([
    { key: SETTING_KEYS.accountId, value: config.accountId.trim(), updated_at: now },
    { key: SETTING_KEYS.merchantName, value: config.merchantName.trim(), updated_at: now },
    { key: SETTING_KEYS.city, value: config.city.trim() || 'Phnom Penh', updated_at: now },
  ]);
  if (error) throw error;
}

export interface GenerateKhqrOptions {
  config: BakongConfig;
  /** Price in USD. Baked into the payload so the payer can't mistype it. */
  amount: number;
  /** Payment ticket id — becomes the QR's bill number. */
  billNumber?: string | null;
  /** Shown as the store label in some banking apps. */
  storeLabel?: string | null;
  /** How long this QR stays valid; defaults to the 3-minute ticket window. */
  expiresInMs?: number;
}

export interface GeneratedKhqr {
  /** The KHQR payload — what the QR image encodes, and what the ABA
   *  deeplink carries (see buildAbaDeeplink in khqr.ts). */
  payload: string;
  /** MD5 of the payload. This is the handle Bakong's Open API uses to
   *  answer "has this exact QR been paid?" (check_transaction_by_md5),
   *  so it is worth storing alongside the ticket. */
  md5: string;
}

/**
 * Builds a fresh KHQR for one payment attempt. Returns null rather than
 * throwing when the SDK rejects the inputs: a failed generation must fall
 * back to the uploaded QR, never leave the viewer with no way to pay.
 */
export async function generateKhqr(opts: GenerateKhqrOptions): Promise<GeneratedKhqr | null> {
  const { config, amount, billNumber, storeLabel, expiresInMs = 3 * 60 * 1000 } = opts;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  try {
    const { BakongKHQR, IndividualInfo, khqrData } = await import('bakong-khqr');
    const info = new IndividualInfo(config.accountId, config.merchantName, config.city, {
      currency: khqrData.currency.usd,
      amount,
      billNumber: billNumber ?? undefined,
      storeLabel: storeLabel ?? undefined,
      expirationTimestamp: Date.now() + expiresInMs,
    });
    const result = new BakongKHQR().generateIndividual(info);
    // The SDK reports failure through a status object instead of throwing.
    if (!result?.data?.qr || (result.status && result.status.code !== 0)) return null;
    return { payload: result.data.qr, md5: result.data.md5 };
  } catch {
    return null;
  }
}

/**
 * Renders a KHQR payload to a PNG data URL so it can be shown as an
 * ordinary <img>. High error correction, because this gets scanned off a
 * phone screen held by someone else's phone.
 */
export async function renderQrDataUrl(payload: string): Promise<string | null> {
  try {
    const QRCode = (await import('qrcode')).default;
    return await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'H',
      margin: 1,
      scale: 8,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch {
    return null;
  }
}
