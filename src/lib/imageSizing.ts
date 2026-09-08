// Poster and banner artwork, normalised before it ever reaches storage.
//
// The problem this solves is visible on the home screen. Admin uploads
// whatever the phone or the download gave it — routinely a 3000px, 4 MB
// PNG — and `AdminScreen.uploadImage` used to put that file in the bucket
// byte for byte. The rails then render it at 104 CSS pixels wide. So every
// rail on the home screen downloads a few megabytes to draw a thumbnail,
// which is most of why scrolling stutters on a Khmer mobile connection:
// the phone is decoding full-resolution artwork while the finger moves.
//
// It is also why covers look inconsistent. A poster uploaded 1:1 and a
// poster uploaded 2:3 both land in an `aspect-[2/3]` box, so one of them
// gets silently cropped by `object-cover` in whatever way the browser
// picks. Cropping here, once, on a known rule (centre, weighted slightly
// to the top so faces survive) means every cover in a rail is framed the
// same way.
//
// Two presets, matching the two shapes the app actually renders:
//
//   poster  2:3   600×900   — rails, grids, hero cover, detail header
//   banner  16:9  1600×900  — hero ambience, show detail backdrop
//
// Those are ~2x the largest CSS size each is ever drawn at, which is the
// point where a retina phone stops being able to tell the difference.
//
// Failure is never fatal: every path that cannot decode, draw or encode
// returns the ORIGINAL file. A resize is a courtesy — it must never be
// the reason a show ends up with no artwork.

export type ImageKind = 'poster' | 'banner';

interface Preset {
  /** Target box. The image is cover-cropped to this exact aspect. */
  width: number;
  height: number;
  /** Vertical bias of the crop, 0 = top edge, 0.5 = centre. Posters
   *  crop from slightly above centre because that is where the subject
   *  of a key-art poster almost always sits. */
  focusY: number;
  quality: number;
  label: string;
}

export const IMAGE_PRESETS: Record<ImageKind, Preset> = {
  poster: { width: 720, height: 1080, focusY: 0.42, quality: 0.86, label: '2:3 · 720×1080' },
  banner: { width: 1920, height: 1080, focusY: 0.45, quality: 0.84, label: '16:9 · 1920×1080' },
};

/**
 * The smallest source that can still fill each slot at full sharpness.
 *
 * A resize never invents detail: feed this a 225×315 poster and it stays
 * a 225×315 poster, because `resizeImage` refuses to upscale. So the
 * quality ceiling of the whole app is set at upload time, by the file the
 * admin picks — which is why ArtworkPicker warns when a source lands
 * under these numbers rather than silently accepting a blurry cover.
 *
 * The numbers come from the largest place each shape is drawn, times the
 * 3× pixel ratio of the phones this app actually runs on:
 *
 *   poster  the hero cover, 152 CSS px wide  →  456 real px
 *   banner  the movie card, ~600 CSS px wide → 1800 real px
 *
 * Anything at or above the preset is ideal. Anything under the minimum
 * will look soft no matter what the app does with it.
 */
export const MIN_SOURCE: Record<ImageKind, { width: number; height: number }> = {
  poster: { width: 500, height: 750 },
  banner: { width: 1280, height: 720 },
};

export interface PreparedImage {
  /** The file to upload — resized when that worked, the original otherwise. */
  file: File;
  /** Byte size before and after, for the "4.1 MB → 96 KB" line in Admin. */
  before: number;
  after: number;
  /** False when every resize path failed and the original is passed through. */
  resized: boolean;
  width: number;
  height: number;
}

/** "96 KB" / "4.1 MB" — used by the Admin upload hint. */
export function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

function decode(file: File): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const el = new Image();
    const done = (result: HTMLImageElement | null) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = window.setTimeout(() => done(null), 10_000);
    el.onload = () => {
      window.clearTimeout(timer);
      done(el.naturalWidth ? el : null);
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      done(null);
    };
    el.src = url;
  });
}

// WebP is ~30% smaller than JPEG at the same visible quality and every
// browser Telegram embeds supports it — but Safari only learned
// `toBlob('image/webp')` in 14, so this asks for it and checks what came
// back rather than assuming.
async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  const webp = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/webp', quality);
  });
  if (webp && webp.type === 'image/webp') return webp;
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
}

/**
 * Cover-crop `file` to the preset's aspect ratio and redraw it at the
 * preset's size. Never upscales: a 400px-wide poster stays 400px wide
 * (at the right aspect), because inventing pixels only makes the file
 * bigger and the artwork softer.
 */
export async function prepareShowImage(file: File, kind: ImageKind): Promise<PreparedImage> {
  const preset = IMAGE_PRESETS[kind];
  const passthrough: PreparedImage = {
    file,
    before: file.size,
    after: file.size,
    resized: false,
    width: 0,
    height: 0,
  };

  if (!file.type.startsWith('image/')) return passthrough;
  // An animated GIF would come out as a single still frame, and an SVG
  // has no pixels to resample — both are better left exactly as they are.
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return passthrough;

  try {
    const img = await decode(file);
    if (!img) return passthrough;

    const srcW = img.naturalWidth;
    const srcH = img.naturalHeight;
    const aspect = preset.width / preset.height;

    // Output box: the preset, shrunk if the source cannot fill it.
    const cap = Math.min(1, srcW / preset.width, srcH / preset.height);
    const outW = Math.max(1, Math.round(preset.width * (cap < 1 ? cap : 1)));
    const outH = Math.max(1, Math.round(outW / aspect));

    // Source window: the largest rectangle of the original at the target
    // aspect, positioned horizontally centred and vertically by focusY.
    let cropW = srcW;
    let cropH = Math.round(srcW / aspect);
    if (cropH > srcH) {
      cropH = srcH;
      cropW = Math.round(srcH * aspect);
    }
    const sx = Math.max(0, Math.round((srcW - cropW) / 2));
    const sy = Math.max(0, Math.min(srcH - cropH, Math.round((srcH - cropH) * preset.focusY)));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return passthrough;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Artwork with transparency (a logo PNG used as a poster) would
    // otherwise flatten to black once encoded as JPEG.
    ctx.fillStyle = '#0A101E';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH);

    const blob = await encode(canvas, preset.quality);
    if (!blob) return passthrough;
    // A small, already-optimised upload can come back bigger after a
    // re-encode. Keep whichever is smaller — but keep the redraw when the
    // shape changed, since the crop is the point, not just the bytes.
    const shapeChanged = srcW !== outW || srcH !== outH;
    if (blob.size >= file.size && !shapeChanged) return passthrough;

    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const stem = file.name.replace(/\.[^.]+$/, '') || kind;
    return {
      file: new File([blob], `${stem}.${ext}`, { type: blob.type, lastModified: Date.now() }),
      before: file.size,
      after: blob.size,
      resized: true,
      width: outW,
      height: outH,
    };
  } catch {
    return passthrough;
  }
}
