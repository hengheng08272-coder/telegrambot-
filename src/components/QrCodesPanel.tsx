import { useEffect, useRef, useState } from 'react';
import { Loader2, QrCode, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { PRICING_TIERS } from '@/lib/subscription';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

// Real KHQR images bundled with the app on day one — shown here so the
// admin knows a tier isn't actually blank even before they've uploaded
// their own replacement.
const FALLBACK_QR_IMAGES: Record<string, string> = {
  '1m': '/assets/qr-1m.png',
  '2m': '/assets/qr-1m-bonus.png',
  '6m': '/assets/qr-6m.png',
  '12m': '/assets/qr-12m.png',
};

// Not a real VIP plan — 'movie' is the tier key MoviePurchaseModal reads
// for the flat $1 standalone-movie QR (see database/movie-purchases-
// addition.sql). Listed here too so uploading it needs no separate
// screen.
const MOVIE_TIER = { key: 'movie', labelEn: 'Movie (pay-per-title)', price: 1 };

export default function QrCodesPanel({ onClose }: Props) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingTier, setUploadingTier] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingTierRef = useRef<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error: err } = await supabase.from('payment_qr_codes').select('tier, image_url');
    if (err) setError(err.message);
    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row.image_url) map[row.tier] = row.image_url;
    }
    setImages(map);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const triggerUpload = (tierKey: string) => {
    pendingTierRef.current = tierKey;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const tierKey = pendingTierRef.current;
    e.target.value = '';
    if (!file || !tierKey) return;

    setUploadingTier(tierKey);
    setError('');

    const ext = file.name.split('.').pop() || 'png';
    const path = `${tierKey}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('payment-qr-codes')
      .upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) {
      setError(upErr.message);
      setUploadingTier(null);
      return;
    }

    const { data: pub } = supabase.storage.from('payment-qr-codes').getPublicUrl(path);
    const { error: upsertErr } = await supabase.from('payment_qr_codes').upsert({
      tier: tierKey,
      image_url: pub.publicUrl,
      updated_at: new Date().toISOString(),
    });
    setUploadingTier(null);
    if (upsertErr) {
      setError(upsertErr.message);
      return;
    }
    load();
  };

  return (
    <AdminPanelShell
      title="Payment QR codes"
      subtitle="The KHQR image each plan shows to viewers"
      icon={<QrCode className="h-4 w-4" />}
      accent="#FFD166"
      maxWidth="max-w-[900px]"
      onClose={onClose}
    >

        <p className="mb-4 text-xs leading-relaxed text-white/50">
          Upload the KHQR image for each plan here — this is what viewers scan to pay. Replace it
          anytime your bank QR changes; no developer needed. Make sure the amount printed on the QR
          matches the plan's price exactly.
        </p>

        {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : (
            [...PRICING_TIERS, MOVIE_TIER].map((tier) => (
              <div key={tier.key} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30">
                  {images[tier.key] || FALLBACK_QR_IMAGES[tier.key] ? (
                    <img
                      src={images[tier.key] || FALLBACK_QR_IMAGES[tier.key]}
                      alt={tier.key}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <QrCode className="h-6 w-6 text-white/20" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{tier.labelEn} — ${tier.price}</p>
                  <p className="text-xs text-white/40">
                    {images[tier.key]
                      ? 'QR uploaded'
                      : FALLBACK_QR_IMAGES[tier.key]
                        ? 'Using default QR — upload to replace'
                        : 'No QR yet — viewers see a contact-admin message'}
                  </p>
                </div>
                <button
                  onClick={() => triggerUpload(tier.key)}
                  disabled={uploadingTier === tier.key}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#FFD166]/30 bg-[#FFD166]/10 px-3 py-1.5 text-xs font-bold text-[#FFD166] transition hover:bg-[#FFD166]/20 disabled:opacity-50"
                >
                  {uploadingTier === tier.key ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {images[tier.key] || FALLBACK_QR_IMAGES[tier.key] ? 'Replace' : 'Upload'}
                </button>
              </div>
            ))
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelected}
        />
    </AdminPanelShell>
  );
}
