// Client-side receipt shrinking.
//
// A receipt is a phone screenshot: on a modern handset that is routinely
// 3–6 MB of PNG for a picture of some text. Uploading that over a Khmer
// mobile connection is the slowest part of the whole payment, and the
// admin only ever looks at it on a phone. Anything over the threshold is
// redrawn at a sane size as JPEG; anything under it is passed through
// untouched.
//
// Every failure path returns the ORIGINAL file. Compression is a
// convenience — it must never be the reason a payment can't be proven.

const MAX_BYTES = 2_000_000; // ~2 MB
const MAX_EDGE = 1600; // still comfortably readable for amounts/ids
const QUALITY = 0.82;

export async function compressReceipt(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= MAX_BYTES) return file;

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      const timer = window.setTimeout(() => resolve(null), 8000);
      el.onload = () => {
        window.clearTimeout(timer);
        resolve(el);
      };
      el.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      el.src = url;
    });
    if (!img || !img.naturalWidth) return file;

    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // Screenshots are pasted on white in the bank apps; filling first
    // keeps a transparent PNG from turning into a black rectangle.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', QUALITY);
    });
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') || 'receipt';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
