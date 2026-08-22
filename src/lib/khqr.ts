import jsQR from 'jsqr';

// =====================================================================
// One-tap ABA: turn the tier's KHQR image into ABA Mobile's own deeplink.
//
// WHY
//   The admin's PayWay link (https://link.payway.com.kh/ABAPAY...) is a
//   web page, so tapping it always costs two steps: the page loads, then
//   PayWay itself asks "Open this page in ABA Mobile?". That second
//   prompt belongs to PayWay/iOS -- no amount of front-end work removes
//   it while the destination is a web page.
//
//   ABA's own scheme skips the web entirely:
//     abamobilebank://ababank.com?type=payway&qrcode=<KHQR string>
//   This is the exact shape PayWay's API returns as `abapay_deeplink`,
//   and the `qrcode` value is just the KHQR payload -- the same payload
//   already encoded in the QR image the admin uploaded per tier. So the
//   deeplink can be rebuilt locally with no PayWay merchant account.
//
// HOW
//   Read the QR image back into a canvas and decode it once per tier,
//   then cache. Everything degrades quietly: a decode failure, a CORS
//   refusal, or a viewer without ABA installed all fall back to the
//   existing PayWay link, so the worst case is exactly today's flow.
// =====================================================================

const cache = new Map<string, string | null>();

// jsQR misses far more often than it should on real-world KHQR exports —
// large source images (some bank apps export 2000px+ PNGs), a logo baked
// into the finder-pattern quiet zone, or a color profile that leaves the
// "white" modules slightly off-white all trip it up even though the code
// is perfectly scannable by a phone camera. A single pass at native
// resolution was silently failing on every real upload in production
// (all four tiers came back with no khqr_string). This tries native
// resolution first, then a couple of downscaled passes — each a fresh
// canvas — since jsQR's own scaling behaves differently at different
// source sizes and a size that fails at 2000px can succeed at 800px.
const DECODE_WIDTHS = [0, 900, 600, 1400]; // 0 = native size, tried first

function decodeFromCanvasSource(
  img: HTMLImageElement,
  targetWidth: number,
): string | null {
  const scale = targetWidth > 0 ? targetWidth / img.naturalWidth : 1;
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const code = jsQR(data.data, data.width, data.height, {
    inversionAttempts: 'attemptBoth',
  });
  return code?.data ?? null;
}

function decodeWithRetries(img: HTMLImageElement): string | null {
  for (const width of DECODE_WIDTHS) {
    try {
      const value = decodeFromCanvasSource(img, width);
      if (value) return value;
    } catch {
      // A tainted canvas or decode error at one size shouldn't stop the
      // other sizes from being tried.
    }
  }
  return null;
}

/** Reads the KHQR payload back out of a QR image URL. Null on any failure. */
export async function decodeKhqrFromImage(url: string): Promise<string | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url) ?? null;

  const result = await new Promise<string | null>((resolve) => {
    const img = new Image();
    // Required to read pixels back off the canvas. Supabase storage
    // serves public objects with a permissive CORS header; if a given
    // host does not, the canvas taints and we resolve null instead of
    // throwing.
    img.crossOrigin = 'anonymous';

    const done = (value: string | null) => resolve(value);
    const timer = window.setTimeout(() => done(null), 6000);

    img.onload = () => {
      window.clearTimeout(timer);
      done(decodeWithRetries(img));
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    img.src = url;
  });

  cache.set(url, result);
  return result;
}

/**
 * Sanity-checks a decoded payload before it is handed to ABA. A KHQR
 * string always starts with the EMVCo payload-format indicator "0002",
 * so anything else (a URL, a logo watermark misread, junk) is rejected
 * rather than sent to the bank app as a broken deeplink.
 */
export function isKhqrPayload(value: string | null | undefined): value is string {
  return !!value && value.length > 40 && value.startsWith('0002');
}

/**
 * Decodes a KHQR payload straight out of a File the admin just picked,
 * before it is ever uploaded. This is the reliable path: a local File
 * has no origin, so there is no CORS involved and no chance of a
 * tainted canvas -- unlike decodeKhqrFromImage above, which has to
 * re-download the stored image and depends on the storage host sending
 * the right headers. The result is saved next to the image so viewers
 * never decode anything at all.
 */
export async function decodeKhqrFromFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const result = await new Promise<string | null>((resolve) => {
      const img = new Image();
      const done = (v: string | null) => resolve(v);
      const timer = window.setTimeout(() => done(null), 8000);
      img.onload = () => {
        window.clearTimeout(timer);
        done(decodeWithRetries(img));
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        done(null);
      };
      img.src = url;
    });
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Builds ABA Mobile's deeplink for a KHQR payload. */
export function buildAbaDeeplink(khqr: string): string {
  return `abamobilebank://ababank.com?type=payway&qrcode=${encodeURIComponent(khqr)}`;
}

export interface PayPageOptions {
  /** KHQR payload — the page rebuilds the ABA deeplink from this. */
  khqr: string;
  /** Public URL of the tier's QR image, so the page can show it. */
  qrSrc?: string | null;
  /** Plan name and price, purely for what the page displays. */
  plan?: string | null;
  amount?: string | null;
  /** Short ticket reference, so a viewer can quote it in support chat. */
  ticket?: string | null;
  /** Merchant name, so the page can draw the same KHQR ticket the app does. */
  merchantName?: string | null;
  /**
   * The admin's PayWay link for this tier, if there is one. The page
   * keeps it in reserve and only offers it once the deeplink has
   * demonstrably failed to open ABA — the same fallback the app does,
   * moved to where the failure actually happens.
   */
  payLink?: string | null;
  /**
   * Which half of the checkout page leads: 'aba' puts the hand-off to the
   * bank first, 'qr' puts the QR first for someone paying from another
   * bank's app. Same page either way — KHQR is one standard, so there is
   * exactly one QR and only ABA publishes a scheme worth linking to.
   */
  mode?: 'aba' | 'qr';
  lang?: string;
}

/**
 * URL of the standalone checkout page (public/pay/index.html), which is
 * what we hand to Safari.
 *
 * Inside Telegram the Mini App lives in Telegram's own WebView, and that
 * WebView routinely swallows a navigation to a non-http scheme -- which
 * is why tapping the ABA deeplink there behaves "like text, not a link"
 * (see armDeeplinkFallback below for the full story). Telegram's
 * openLink() will, however, hand an https URL to the system browser, so
 * the way to reach ABA from inside Telegram is to open THIS page in
 * Safari and let the viewer tap the deeplink from there, where iOS
 * honours it.
 *
 * Everything in the query string is data the QR itself already encodes
 * publicly, plus display labels -- nothing secret travels here.
 */
export function buildPayPageUrl(opts: PayPageOptions): string {
  const params = new URLSearchParams();
  params.set('khqr', opts.khqr);
  if (opts.qrSrc) params.set('qr', opts.qrSrc);
  if (opts.plan) params.set('plan', opts.plan);
  if (opts.amount) params.set('amount', opts.amount);
  if (opts.ticket) params.set('ticket', opts.ticket);
  if (opts.merchantName) params.set('name', opts.merchantName);
  if (opts.payLink) params.set('pay', opts.payLink);
  if (opts.mode) params.set('mode', opts.mode);
  params.set('lang', opts.lang ?? 'km');

  // Where "back to the app" should point. Without a configured bot
  // username there is no Mini App link to return to, so the page simply
  // doesn't render that button.
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  if (botUsername) params.set('ret', `https://t.me/${botUsername}/app`);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/pay/?${params.toString()}`;
}

/**
 * Watches for the hand-off to another app and runs `onFallback` if it
 * never happens.
 *
 * This deliberately does NOT navigate. The navigation itself must come
 * from a real <a href="abamobilebank://..."> that the viewer taps,
 * because that is the only form every WebView treats as a genuine
 * link: an iOS WKWebView hands a non-http scheme to the system from a
 * link click, while a scripted `location.href = 'abamobilebank://...'`
 * is frequently swallowed with no error at all -- which is exactly the
 * "it behaves like plain text, not a link" symptom. Pasting the same
 * string somewhere it renders as a real link (Notes, Safari) opens ABA
 * every time; so the button has to BE a link, not simulate one.
 *
 * There is no success callback for a scheme hand-off, so the only
 * reliable signal is that this page stops being frontmost. Arm the
 * watchers on the click, then after a short grace period, if we are
 * still in the foreground, assume nothing happened and fall back.
 */
export function armDeeplinkFallback(onFallback: () => void, graceMs = 1800): void {
  let handled = false;

  const markHandled = () => {
    handled = true;
  };
  document.addEventListener('visibilitychange', markHandled, { once: true });
  window.addEventListener('pagehide', markHandled, { once: true });
  window.addEventListener('blur', markHandled, { once: true });

  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', markHandled);
    window.removeEventListener('pagehide', markHandled);
    window.removeEventListener('blur', markHandled);
    if (!handled && document.visibilityState === 'visible') onFallback();
  }, graceMs);
}

/**
 * Scripted version, kept for callers that have no element to attach to.
 * Prefer a real anchor plus armDeeplinkFallback() -- see the note above
 * for why a scripted navigation is the less reliable of the two.
 */
export function openDeeplinkWithFallback(deeplink: string, onFallback: () => void): void {
  armDeeplinkFallback(onFallback);
  try {
    window.location.href = deeplink;
  } catch {
    onFallback();
  }
}

// =====================================================================
// Reading fields back out of a KHQR payload
//
// A KHQR string is EMVCo TLV: <2-digit tag><2-digit length><value>,
// repeated. Tag 54 is the transaction amount and tag 59 the merchant
// name. Being able to read those means the admin panel can check the
// amount actually baked into the QR against the price configured for
// the tier -- the one mismatch that silently charges a viewer the wrong
// money, because the QR is the thing ABA obeys, not the app's label.
// =====================================================================

function readTlv(payload: string): Map<string, string> {
  const fields = new Map<string, string>();
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    if (!Number.isFinite(len) || len < 0) break;
    const value = payload.slice(i + 4, i + 4 + len);
    if (value.length < len) break;
    if (!fields.has(tag)) fields.set(tag, value);
    i += 4 + len;
  }
  return fields;
}

/** Transaction amount baked into a KHQR payload (tag 54). Null if absent. */
export function readKhqrAmount(payload: string | null | undefined): number | null {
  if (!isKhqrPayload(payload)) return null;
  const raw = readTlv(payload).get('54');
  if (!raw) return null;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/** Merchant name baked into a KHQR payload (tag 59). Null if absent. */
export function readKhqrMerchant(payload: string | null | undefined): string | null {
  if (!isKhqrPayload(payload)) return null;
  return readTlv(payload).get('59')?.trim() || null;
}
