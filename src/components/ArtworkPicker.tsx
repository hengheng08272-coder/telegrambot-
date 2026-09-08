import { useEffect, useState } from 'react';
import { AlertTriangle, ImagePlus, Loader2, X } from 'lucide-react';
import {
  prepareShowImage,
  formatBytes,
  IMAGE_PRESETS,
  MIN_SOURCE,
  type ImageKind,
  type PreparedImage,
} from '@/lib/imageSizing';

interface Props {
  kind: ImageKind;
  label: string;
  /** Artwork already on the show, shown in the frame until a new file is
   *  picked — so replacing a poster is a comparison, not a guess. */
  currentUrl?: string | null;
  value: PreparedImage | null;
  onChange: (value: PreparedImage | null) => void;
  /** Draw the badge safe zones over the preview. Set when the show is
   *  marked as having its title painted into the artwork: those covers
   *  have to be composed around the badges rather than under them, and
   *  the only place to check that is here, before the file is saved. */
  safeZones?: boolean;
}

/**
 * The artwork field in Admin — a framed drop target at the exact aspect
 * ratio the app will render, not a bare `<input type="file">`.
 *
 * Two things go wrong with a bare file input here, and the frame fixes
 * both. First, nothing tells the person uploading what shape the app
 * wants, so a 1:1 poster gets silently cropped by `object-cover` in the
 * rails and the show ends up with someone's forehead as its cover. The
 * preview crops the same way the app will, before it is saved. Second,
 * the file went to storage untouched — see lib/imageSizing for why a 4 MB
 * poster is a home-screen scrolling problem — and the "4.1 MB → 96 KB"
 * line makes that shrink visible rather than silent.
 */
export default function ArtworkPicker({ kind, label, currentUrl, value, onChange, safeZones }: Props) {
  const preset = IMAGE_PRESETS[kind];
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // The object URL belongs to the prepared file, so it is created and
  // revoked with it rather than on every render.
  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const pick = async (file: File | null) => {
    if (!file) {
      onChange(null);
      return;
    }
    setBusy(true);
    try {
      onChange(await prepareShowImage(file, kind));
    } finally {
      setBusy(false);
    }
  };

  const shown = previewUrl ?? currentUrl ?? null;

  // A resize cannot invent detail. If the picked file is smaller than the
  // slot needs on a 3x phone, the cover will be soft however good the
  // rest of the pipeline is, and the only fix is a bigger source file —
  // so say that here, at the moment there is still a chance to pick a
  // different one, rather than discovering it on the home screen.
  const min = MIN_SOURCE[kind];
  const tooSmall = value !== null && (value.width < min.width || value.height < min.height);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label className="text-[11px] font-semibold text-white/60">{label}</label>
        <span className="shrink-0 text-[11px] tabular-nums text-white/35">{preset.label}</span>
      </div>

      <div className="flex items-start gap-3">
        <div
          className="relative shrink-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10"
          style={{
            width: kind === 'poster' ? (safeZones ? 104 : 64) : 128,
            aspectRatio: `${preset.width} / ${preset.height}`,
          }}
        >
          {shown ? (
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-white/25">
              <ImagePlus className="h-4 w-4" />
            </span>
          )}
          {/* Badge safe zone. Only the top strip is reserved now: EP n
              and ចប់ moved off the poster into the card's meta row, so
              the bottom of the artwork is free and a painted title can
              run all the way down. What still sits on the cover is the
              access badge (ឥតគិតថ្លៃ / សមាជិក) top-left and ថ្មី /
              ឆាប់ៗនេះ top-right. Drawn as red hatching so a collision
              is visible here rather than on the home screen. */}
          {safeZones && (
            <span aria-hidden className="pointer-events-none absolute inset-0">
              <span
                className="absolute inset-x-0 top-0"
                style={{
                  height: '18%',
                  background:
                    'repeating-linear-gradient(45deg, rgba(230,35,31,0.35) 0 4px, rgba(230,35,31,0.12) 4px 8px)',
                  borderBottom: '1px solid rgba(230,35,31,0.6)',
                }}
              />
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/60">
              <Loader2 className="h-4 w-4 animate-spin text-white/80" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1 file:text-white"
          />
          {value ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/45">
              {value.resized ? (
                <>
                  <span className="tabular-nums">
                    {value.width}×{value.height}
                  </span>
                  <span className="h-2.5 w-px bg-white/20" aria-hidden />
                  <span className="tabular-nums">
                    {formatBytes(value.before)} → <span className="font-bold text-[#2FD98C]">{formatBytes(value.after)}</span>
                  </span>
                </>
              ) : (
                // Passed through untouched — a GIF, an SVG, or a decode
                // that failed. Said out loud so a surprising upload size
                // later is not a mystery.
                <span>{formatBytes(value.after)} · uploaded as-is</span>
              )}
              <button
                type="button"
                onClick={() => onChange(null)}
                className="ml-auto flex items-center gap-1 rounded px-1 py-0.5 text-white/45 transition hover:bg-white/5 hover:text-white"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-white/35">
              Cropped to {preset.label} and re-encoded before upload. Pick a source at least{' '}
              <span className="tabular-nums">
                {min.width}×{min.height}
              </span>{' '}
              — bigger is fine, smaller cannot be recovered.
            </p>
          )}

          {tooSmall && (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-[#E6231F]/12 px-2 py-1.5 text-[11px] leading-snug text-[#FF8A80] ring-1 ring-inset ring-[#E6231F]/30">
              <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
              <span>
                រូបភាពតូចពេក — <span className="tabular-nums">{value?.width}×{value?.height}</span>. ត្រូវការយ៉ាងតិច{' '}
                <span className="tabular-nums">
                  {min.width}×{min.height}
                </span>{' '}
                ទើបមិនព្រិល។ សូមរកឯកសារធំជាងនេះ។
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
