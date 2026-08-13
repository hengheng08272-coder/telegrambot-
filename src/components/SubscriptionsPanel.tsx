import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Check, Loader2, QrCode, Save, Upload, X, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { PRICING_TIERS } from '@/lib/subscription';
import { fetchAbaMerchantName, saveAbaMerchantName } from '@/lib/api';

interface Props {
  onClose: () => void;
}

// Real KHQR images bundled with the app on day one — the panel shows
// these until the admin uploads a replacement.
const FALLBACK_QR_IMAGES: Record<string, string> = {
  '1m': '/assets/qr-1m.png',
  '2m': '/assets/qr-1m-bonus.png',
  '6m': '/assets/qr-6m.png',
  '12m': '/assets/qr-12m.png',
};

interface TierEdits {
  price: string;
  months: string;
  pitch_km: string;
  bonus_enabled: boolean;
}

export default function SubscriptionsPanel({ onClose }: Props) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, TierEdits>>({});
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingTier, setUploadingTier] = useState<string | null>(null);
  const [savingTier, setSavingTier] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingTierRef = useRef<string | null>(null);

  // ABA auto-confirm matching — the name printed on every real ABA
  // notification for this account, used by the aba-payment-webhook
  // function to make sure a stray/unrelated group message can never be
  // mistaken for a real payment. Everything else about auto-confirm
  // (which amounts are valid, which tier they map to) already comes from
  // the pricing_tiers table above — this is the one extra piece of admin
  // config auto-confirm needs.
  const [abaMerchantName, setAbaMerchantName] = useState('');
  const [abaMerchantNameLoaded, setAbaMerchantNameLoaded] = useState(false);
  const [abaSaving, setAbaSaving] = useState(false);
  const [abaSaved, setAbaSaved] = useState(false);

  useEffect(() => {
    fetchAbaMerchantName().then((name) => {
      if (name) setAbaMerchantName(name);
      setAbaMerchantNameLoaded(true);
    });
  }, []);

  const handleSaveAbaMerchantName = async () => {
    const value = abaMerchantName.trim();
    if (!value) return;
    setAbaSaving(true);
    setError('');
    try {
      await saveAbaMerchantName(value);
      setAbaSaved(true);
      setTimeout(() => setAbaSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save ABA merchant name');
    } finally {
      setAbaSaving(false);
    }
  };

  const load = async () => {
    setLoading(true);
    const [qrRes, priceRes] = await Promise.all([
      supabase.from('payment_qr_codes').select('tier, image_url'),
      supabase.from('pricing_tiers').select('key, price, months, pitch_km, bonus_enabled'),
    ]);
    if (qrRes.error) setError(qrRes.error.message);

    const qrMap: Record<string, string> = {};
    for (const row of qrRes.data ?? []) {
      if (row.image_url) qrMap[row.tier] = row.image_url;
    }
    setImages(qrMap);

    const priceMap = new Map((priceRes.data ?? []).map((r) => [r.key, r]));
    const nextEdits: Record<string, TierEdits> = {};
    for (const tier of PRICING_TIERS) {
      const override = priceMap.get(tier.key);
      nextEdits[tier.key] = {
        price: String(override?.price ?? tier.price),
        months: String(override?.months ?? tier.months),
        pitch_km: override?.pitch_km ?? tier.pitchKm ?? '',
        bonus_enabled: override?.bonus_enabled ?? tier.bonusEnabled,
      };
    }
    setEdits(nextEdits);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const triggerUpload = (tierKey: string) => {
    pendingTierRef.current = tierKey;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
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

  const updateEdit = (tierKey: string, field: 'price' | 'months' | 'pitch_km', value: string) => {
    setEdits((prev) => ({ ...prev, [tierKey]: { ...prev[tierKey], [field]: value } }));
  };

  const toggleBonus = (tierKey: string) => {
    setEdits((prev) => ({
      ...prev,
      [tierKey]: { ...prev[tierKey], bonus_enabled: !prev[tierKey].bonus_enabled },
    }));
  };

  const saveTier = async (tier: (typeof PRICING_TIERS)[number]) => {
    const edit = edits[tier.key];
    const price = parseFloat(edit.price);
    if (!price || price <= 0) {
      setError('Enter a valid price.');
      return;
    }
    const months = parseInt(edit.months, 10);
    if (!months || months <= 0) {
      setError('Enter a valid duration (months).');
      return;
    }
    setSavingTier(tier.key);
    setError('');
    const { error: err } = await supabase.from('pricing_tiers').upsert({
      key: tier.key,
      price,
      months,
      label_km: tier.labelKm,
      label_en: tier.labelEn,
      pitch_km: edit.pitch_km,
      bonus_enabled: edit.bonus_enabled,
      updated_at: new Date().toISOString(),
    });
    setSavingTier(null);
    if (err) {
      setError(err.message);
      return;
    }
    setSavedAt((prev) => ({ ...prev, [tier.key]: Date.now() }));
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#170D0C] p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <QrCode className="h-4 w-4 text-[#FFC94A]" />
            <h2 className="text-sm font-bold">Subscriptions — QR, price & description</h2>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-white/50">
          Everything a viewer sees when they tap Subscribe — the KHQR they scan, the price, and the
          short pitch line under each plan. Edit any of it here; changes show up immediately, no
          developer or code deploy needed.
        </p>

        {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <div className="mb-4 rounded-xl border border-[#2DD4C4]/20 bg-[#2DD4C4]/[0.04] p-3">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#2DD4C4]">
            <Zap className="h-3.5 w-3.5" /> ABA Auto-confirm
          </p>
          <p className="mb-2 text-[11px] leading-relaxed text-white/50">
            ឈ្មោះម្ចាស់គណនី ABA ដូចដែលបង្ហាញលើសារជូនដំណឹងរបស់ ABA ពិតៗ (ឧ. "PANG SOK HENG")។ ប្រើដើម្បីធានាថា
            មានតែសារបង់ប្រាក់ពិតប្រាកដទៅគណនីនេះទេ ដែលអាច unlock VIP ដោយស្វ័យប្រវត្តិ — សារផ្សេងទៀតក្នុង Group
            មិនប៉ះពាល់ទេ។ តម្លៃនិមួយៗ (Price ខាងក្រោម) ត្រូវបានប្រើដើម្បីផ្គូផ្គងដោយស្វ័យប្រវត្តិរួចហើយ។
          </p>
          <div className="flex gap-2">
            <input
              value={abaMerchantName}
              onChange={(e) => setAbaMerchantName(e.target.value)}
              placeholder={abaMerchantNameLoaded ? 'ឧ. PANG SOK HENG' : 'Loading…'}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2DD4C4]/50"
            />
            <button
              onClick={handleSaveAbaMerchantName}
              disabled={abaSaving || !abaMerchantName.trim()}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
            >
              {abaSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : abaSaved ? (
                <Check className="h-3.5 w-3.5 text-[#4CC950]" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {abaSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : (
            PRICING_TIERS.map((tier) => {
              const edit = edits[tier.key] ?? {
                price: String(tier.price),
                months: String(tier.months),
                pitch_km: tier.pitchKm ?? '',
                bonus_enabled: tier.bonusEnabled,
              };
              const qr = images[tier.key] || FALLBACK_QR_IMAGES[tier.key];
              return (
                <div key={tier.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30">
                      {qr ? (
                        <img src={qr} alt={tier.key} className="h-full w-full object-contain" />
                      ) : (
                        <QrCode className="h-5 w-5 text-white/20" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">{tier.labelEn}</p>
                      <p className="text-xs text-white/40">
                        {images[tier.key] ? 'QR uploaded' : qr ? 'Using default QR' : 'No QR yet'}
                      </p>
                    </div>
                    <button
                      onClick={() => triggerUpload(tier.key)}
                      disabled={uploadingTier === tier.key}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#FFC94A]/30 bg-[#FFC94A]/10 px-3 py-1.5 text-xs font-bold text-[#FFC94A] transition hover:bg-[#FFC94A]/20 disabled:opacity-50"
                    >
                      {uploadingTier === tier.key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {qr ? 'Replace' : 'Upload'}
                    </button>
                  </div>

                  <div className="grid grid-cols-[80px_80px_1fr] gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                        Price ($)
                      </label>
                      <input
                        value={edit.price}
                        onChange={(e) => updateEdit(tier.key, 'price', e.target.value.replace(/[^0-9.]/g, ''))}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm font-bold text-white outline-none focus:border-[#FFC94A]/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                        Duration (mo)
                      </label>
                      <input
                        value={edit.months}
                        onChange={(e) => updateEdit(tier.key, 'months', e.target.value.replace(/[^0-9]/g, ''))}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm font-bold text-white outline-none focus:border-[#2DD4C4]/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                        Description (Khmer)
                      </label>
                      <input
                        value={edit.pitch_km}
                        onChange={(e) => updateEdit(tier.key, 'pitch_km', e.target.value)}
                        placeholder="ឧ. ចាប់ផ្តើមមើលភ្លាមៗ — មួយខែពេញ"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#FFC94A]/50"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => toggleBonus(tier.key)}
                    className="mt-2.5 flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <span className="text-xs font-medium text-white/70">Bonus spin ចាប់រង្វាន់</span>
                    <span
                      className={`relative h-5 w-9 rounded-full transition ${
                        edit.bonus_enabled ? 'bg-[#22C55E]' : 'bg-white/15'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                          edit.bonus_enabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </span>
                  </button>

                  <button
                    onClick={() => saveTier(tier)}
                    disabled={savingTier === tier.key}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-white/10 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
                  >
                    {savingTier === tier.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : savedAt[tier.key] && Date.now() - savedAt[tier.key] < 2000 ? (
                      <Check className="h-3.5 w-3.5 text-[#22C55E]" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save
                  </button>
                </div>
              );
            })
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>
    </div>
  );
}
