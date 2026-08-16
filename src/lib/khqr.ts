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
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(data.data, data.width, data.height);
        done(code?.data ?? null);
      } catch {
        done(null);
      }
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
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return done(null);
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          done(jsQR(data.data, data.width, data.height)?.data ?? null);
        } catch {
          done(null);
        }
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

/**
 * Opens a custom-scheme deeplink, with a web fallback for the two cases
 * it can fail: ABA is not installed, or the client refuses the scheme.
 *
 * Telegram's WebApp.openLink() is for http(s) only, so the scheme has to
 * go through a plain top-level navigation. There is no success callback
 * for that -- the only reliable signal is that the page gets hidden when
 * another app takes over. So: navigate, then after a short grace period,
 * if this page is still in the foreground, assume nothing happened and
 * run the fallback.
 */
export function openDeeplinkWithFallback(deeplink: string, onFallback: () => void): void {
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
  }, 1500);

  try {
    window.location.href = deeplink;
  } catch {
    onFallback();
  }
}
