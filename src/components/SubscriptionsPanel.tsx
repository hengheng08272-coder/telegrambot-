import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Loader2,
  QrCode,
  Save,
  ShieldCheck,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  buildAbaDeeplink,
  decodeKhqrFromFile,
  isKhqrPayload,
  readKhqrAmount,
  readKhqrMerchant,
} from '@/lib/khqr';
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
  label_km: string;
  label_en: string;
  pitch_km: string;
  bonus_enabled: boolean;
}

// Khmer numerals so a label like "៦ ខែ" can be compared against the
// `months` value — see labelMonthsMismatch() below.
const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩';

function firstNumberIn(text: string): number | null {
  const normalised = text.replace(/[០-៩]/g, (d) => String(KHMER_DIGITS.indexOf(d)));
  const m = /\d+/.exec(normalised);
  return m ? parseInt(m[0], 10) : null;
}

// The plan label is what the viewer reads; `months` is what actually gets
// added to their subscription. When those disagree, someone pays for what
// the label promised and silently receives something else — which is
// exactly how the '2m' tier ended up labelled "១ ខែ" while granting 2
// months. Surfacing it in the panel means it gets caught at edit time
// instead of after a customer complains.
function labelMonthsMismatch(labelKm: string, labelEn: string, months: string): number | null {
  const actual = parseInt(months, 10);
  if (!Number.isFinite(actual)) return null;
  // Check both labels — a plan can drift out of sync in either language
  // independently (the Khmer name gets fixed but the English one doesn't,
  // or vice versa), and either one is what some viewer is reading.
  const labelledKm = firstNumberIn(labelKm);
  if (labelledKm !== null && labelledKm !== actual) return labelledKm;
  const labelledEn = firstNumberIn(labelEn);
  if (labelledEn !== null && labelledEn !== actual) return labelledEn;
  return null;
}

export default function SubscriptionsPanel({ onClose }: Props) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [payLinks, setPayLinks] = useState<Record<string, string>>({});
  const [payLinkDrafts, setPayLinkDrafts] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, TierEdits>>({});
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const [payLinkSavedAt, setPayLinkSavedAt] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingTier, setUploadingTier] = useState<string | null>(null);
  const [savingTier, setSavingTier] = useState<string | null>(null);
  const [savingPayLinkTier, setSavingPayLinkTier] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingTierRef = useRef<string | null>(null);

  // The decoded KHQR payload behind each tier's QR image — read straight
  // from payment_qr_codes.khqr_string. This is what actually makes the
  // viewer's one-tap "Open ABA" button work; a missing value here means
  // that button silently disappears for the tier, even though the QR
  // image itself still looks fine and scans fine by hand. Surfacing it
  // per-tier (instead of only failing quietly at upload time) is what
  // makes that state debuggable from the admin side.
  const [khqrStrings, setKhqrStrings] = useState<Record<string, string>>({});
  const [khqrDrafts, setKhqrDrafts] = useState<Record<string, string>>({});
  const [khqrEditingTier, setKhqrEditingTier] = useState<string | null>(null);
  const [savingKhqrTier, setSavingKhqrTier] = useState<string | null>(null);
  const [copiedDeeplinkTier, setCopiedDeeplinkTier] = useState<string | null>(null);
  const [expandedTier, setExpandedTier] = useState<string | null>(null);

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
      supabase.from('payment_qr_codes').select('tier, image_url, pay_link, khqr_string'),
      supabase.from('pricing_tiers').select('key, price, months, label_km, label_en, pitch_km, bonus_enabled'),
    ]);
    if (qrRes.error) setError(qrRes.error.message);

    const qrMap: Record<string, string> = {};
    const linkMap: Record<string, string> = {};
    const khqrMap: Record<string, string> = {};
    for (const row of qrRes.data ?? []) {
      if (row.image_url) qrMap[row.tier] = row.image_url;
      if (row.pay_link) linkMap[row.tier] = row.pay_link;
      if (row.khqr_string) khqrMap[row.tier] = row.khqr_string;
    }
    setImages(qrMap);
    setPayLinks(linkMap);
    setPayLinkDrafts(linkMap);
    setKhqrStrings(khqrMap);
    setKhqrDrafts(khqrMap);

    const priceMap = new Map((priceRes.data ?? []).map((r) => [r.key, r]));
    const nextEdits: Record<string, TierEdits> = {};
    for (const tier of PRICING_TIERS) {
      const override = priceMap.get(tier.key);
      nextEdits[tier.key] = {
        price: String(override?.price ?? tier.price),
        months: String(override?.months ?? tier.months),
        label_km: override?.label_km ?? tier.labelKm,
        label_en: override?.label_en ?? tier.labelEn,
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

    // Read the KHQR payload out of the file BEFORE uploading, while it is
    // still a local File — no CORS, no tainted canvas, no re-download.
    // Stored alongside the image so the payment screen can build the
    // one-tap ABA deeplink without decoding anything.
    const khqr = await decodeKhqrFromFile(file);
    if (!isKhqrPayload(khqr)) {
      // Not fatal: the image still works as a scannable QR. But the
      // one-tap button will be missing for this tier, and silently
      // missing is exactly the kind of thing that wastes an evening.
      setError(
        'រូបនេះ upload បាន តែអានជា KHQR មិនចេញ — ប៊ូតុង "បើក App ABA" នឹងមិនបង្ហាញសម្រាប់ថ្នាក់នេះទេ។ សូមប្រើរូបច្បាស់ជាងនេះ។',
      );
    }

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
    const row: Record<string, unknown> = {
      tier: tierKey,
      image_url: pub.publicUrl,
      updated_at: new Date().toISOString(),
    };
    if (isKhqrPayload(khqr)) row.khqr_string = khqr;

    let { error: upsertErr } = await supabase.from('payment_qr_codes').upsert(row);
    if (upsertErr && /khqr_string/i.test(upsertErr.message)) {
      // Migration not run yet — save the image anyway rather than losing
      // the upload over an optional column.
      delete row.khqr_string;
      ({ error: upsertErr } = await supabase.from('payment_qr_codes').upsert(row));
    }
    setUploadingTier(null);
    if (upsertErr) {
      setError(upsertErr.message);
      return;
    }
    load();
  };

  // Saves the ABA PayWay link for one tier — same payment_qr_codes row
  // as the QR image, so this is an upsert on just the pay_link column.
  // Each tier needs its own link generated for that tier's exact price
  // (ABA Merchant -> Payment Link, fixed amount) — same rule as the QR.
  const savePayLink = async (tierKey: string) => {
    const value = (payLinkDrafts[tierKey] ?? '').trim();
    setSavingPayLinkTier(tierKey);
    setError('');
    const { error: err } = await supabase.from('payment_qr_codes').upsert({
      tier: tierKey,
      pay_link: value || null,
      updated_at: new Date().toISOString(),
    });
    setSavingPayLinkTier(null);
    if (err) {
      setError(err.message);
      return;
    }
    setPayLinks((prev) => ({ ...prev, [tierKey]: value }));
    setPayLinkSavedAt((prev) => ({ ...prev, [tierKey]: Date.now() }));
  };

  // Manual fallback for when automatic decode can't read a tier's QR
  // image (logo overlay, unusual export size/format, etc). Every ABA
  // Business account can show the raw KHQR text for a QR under its own
  // "View/Copy QR" screen — pasting that here restores the one-tap
  // "Open ABA" button for viewers without needing a new image at all.
  const saveKhqrString = async (tierKey: string) => {
    const value = (khqrDrafts[tierKey] ?? '').trim();
    if (value && !isKhqrPayload(value)) {
      setError('អត្ថបទនេះមិនមែនជា KHQR payload ត្រឹមត្រូវទេ (ត្រូវចាប់ផ្តើមដោយ 0002 និងវែងជាង 40 តួ)។');
      return;
    }
    setSavingKhqrTier(tierKey);
    setError('');
    const { error: err } = await supabase.from('payment_qr_codes').upsert({
      tier: tierKey,
      khqr_string: value || null,
      updated_at: new Date().toISOString(),
    });
    setSavingKhqrTier(null);
    if (err) {
      setError(err.message);
      return;
    }
    setKhqrStrings((prev) => {
      const next = { ...prev };
      if (value) next[tierKey] = value;
      else delete next[tierKey];
      return next;
    });
    setKhqrEditingTier(null);
  };

  const updateEdit = (
    tierKey: string,
    field: 'price' | 'months' | 'label_km' | 'label_en' | 'pitch_km',
    value: string,
  ) => {
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
    if (!edit.label_km.trim()) {
      setError('Enter the plan name shown to viewers (Khmer).');
      return;
    }
    setSavingTier(tier.key);
    setError('');
    const { error: err } = await supabase.from('pricing_tiers').upsert({
      key: tier.key,
      price,
      months,
      label_km: edit.label_km.trim(),
      label_en: edit.label_en.trim() || tier.labelEn,
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
    // Re-read so the panel shows what the DB actually holds, not just
    // what was typed — the viewer-facing app reads the same rows.
    load();
  };

  return (
    // Full-screen admin sheet, not a small centered modal — this panel has
    // a lot of per-tier detail (price, months, both labels, pay link, KHQR
    // status) and cramming that into a max-w-lg card meant most fields were
    // only reachable after scrolling inside a scrollbox inside a modal.
    // Full width + a two-column grid on wider screens means every tier's
    // full editor is visible without nested scrolling.
    <div className="fixed inset-0 z-[90] flex flex-col bg-[#0B0C10]">
      <div className="shrink-0 border-b border-white/10 bg-[#0F1116] px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2.5 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E3B341]/10">
              <QrCode className="h-4.5 w-4.5 text-[#E3B341]" />
            </span>
            <div>
              <h2 className="text-sm font-bold sm:text-base">Subscriptions</h2>
              <p className="text-[11px] text-white/40">QR, តម្លៃ, រយៈពេល &amp; ការពិពណ៌នា</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/60 transition hover:border-white/25 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="mb-4 max-w-2xl text-xs leading-relaxed text-white/50">
            Everything a viewer sees when they tap Subscribe — the KHQR they scan, the price, and the
            short pitch line under each plan. Edit any of it here; changes show up immediately, no
            developer or code deploy needed.
          </p>

          {error && <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

          <div className="mb-5 rounded-xl border border-[#2B5CAD]/20 bg-[#2B5CAD]/[0.04] p-4">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#2B5CAD]">
              <Zap className="h-3.5 w-3.5" /> ABA Auto-confirm
            </p>
            <p className="mb-2 max-w-2xl text-[11px] leading-relaxed text-white/50">
              ឈ្មោះម្ចាស់គណនី ABA ដូចដែលបង្ហាញលើសារជូនដំណឹងរបស់ ABA ពិតៗ (ឧ. "PANG SOK HENG")។ ប្រើដើម្បីធានាថា
              មានតែសារបង់ប្រាក់ពិតប្រាកដទៅគណនីនេះទេ ដែលអាច unlock VIP ដោយស្វ័យប្រវត្តិ — សារផ្សេងទៀតក្នុង Group
              មិនប៉ះពាល់ទេ។ តម្លៃនិមួយៗ (Price ខាងក្រោម) ត្រូវបានប្រើដើម្បីផ្គូផ្គងដោយស្វ័យប្រវត្តិរួចហើយ។
            </p>
            <div className="flex max-w-md gap-2">
              <input
                value={abaMerchantName}
                onChange={(e) => setAbaMerchantName(e.target.value)}
                placeholder={abaMerchantNameLoaded ? 'ឧ. PANG SOK HENG' : 'Loading…'}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2B5CAD]/50"
              />
              <button
                onClick={handleSaveAbaMerchantName}
                disabled={abaSaving || !abaMerchantName.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
              >
                {abaSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : abaSaved ? (
                  <Check className="h-3.5 w-3.5 text-[#34B37A]" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {abaSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {PRICING_TIERS.map((tier) => {
              const edit = edits[tier.key] ?? {
                price: String(tier.price),
                months: String(tier.months),
                label_km: tier.labelKm,
                label_en: tier.labelEn,
                pitch_km: tier.pitchKm ?? '',
                bonus_enabled: tier.bonusEnabled,
              };
              const mismatch = labelMonthsMismatch(edit.label_km, edit.label_en, edit.months);
              const qr = images[tier.key] || FALLBACK_QR_IMAGES[tier.key];
              const khqrValue = khqrStrings[tier.key] ?? null;
              const hasKhqr = Boolean(khqrValue);
              const isEditingKhqr = khqrEditingTier === tier.key;
              // The QR is what ABA actually obeys — the price field here
              // is only a label. If they disagree the viewer is charged
              // the QR's amount and auto-confirm then waits forever for
              // the app's amount, so the payer loses money AND gets no
              // VIP. Reading it back out of the payload is the only way
              // to catch that from the admin side.
              const qrAmount = readKhqrAmount(khqrValue);
              const qrMerchant = readKhqrMerchant(khqrValue);
              const priceNumber = parseFloat(edit.price);
              const amountMismatch =
                qrAmount !== null &&
                Number.isFinite(priceNumber) &&
                Math.abs(qrAmount - priceNumber) > 0.001;
              const abaDeeplink = khqrValue ? buildAbaDeeplink(khqrValue) : null;
              return (
                <div key={tier.key} className="flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30">
                      {qr ? (
                        <img src={qr} alt={tier.key} className="h-full w-full object-contain" />
                      ) : (
                        <QrCode className="h-5 w-5 text-white/20" />
                      )}
                    </div>
                    {/* The heading has to read from `edit`, not from the
                        hardcoded PRICING_TIERS entry. `tier.key` is a
                        permanent internal id ('2m') and `tier.labelEn` is
                        only a seed value — once a plan is re-purposed
                        (the '2m' slot now sells 3 months) the code
                        default is stale forever, so a header printing it
                        says "1 Month (Big Bonus)" over a card that is
                        actually configured as 3 months. The internal key
                        moves to a small chip so rows stay identifiable
                        without pretending to be the plan's name. */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold text-white">
                          {edit.label_en.trim() || edit.label_km.trim() || tier.labelEn}
                        </p>
                        <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-white/35">
                          {tier.key}
                        </span>
                      </div>
                      <p className="truncate text-xs text-white/55">
                        {edit.label_km.trim() || '—'}
                        <span className="text-white/30"> · </span>
                        {edit.months || '—'} ខែ
                        <span className="text-white/30"> · </span>${edit.price || '—'}
                      </p>
                      <p className="text-[11px] text-white/35">
                        {images[tier.key] ? 'QR uploaded' : qr ? 'Using default QR' : 'No QR yet'}
                      </p>
                    </div>
                    <button
                      onClick={() => triggerUpload(tier.key)}
                      disabled={uploadingTier === tier.key}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#E3B341]/30 bg-[#E3B341]/10 px-3 py-1.5 text-xs font-bold text-[#E3B341] transition hover:bg-[#E3B341]/20 disabled:opacity-50"
                    >
                      {uploadingTier === tier.key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {qr ? 'Replace' : 'Upload'}
                    </button>
                  </div>

                  <div className="grid grid-cols-[76px_76px_1fr] gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                        តម្លៃ ($)
                      </label>
                      <input
                        inputMode="decimal"
                        value={edit.price}
                        onChange={(e) => updateEdit(tier.key, 'price', e.target.value.replace(/[^0-9.]/g, ''))}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm font-bold text-white outline-none focus:border-[#E3B341]/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                        រយៈពេល (ខែ)
                      </label>
                      <input
                        inputMode="numeric"
                        value={edit.months}
                        onChange={(e) => updateEdit(tier.key, 'months', e.target.value.replace(/[^0-9]/g, ''))}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm font-bold text-white outline-none focus:border-[#2B5CAD]/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                        ឈ្មោះគម្រោង (ខ្មែរ)
                      </label>
                      <input
                        value={edit.label_km}
                        onChange={(e) => updateEdit(tier.key, 'label_km', e.target.value)}
                        placeholder="ឧ. ៣ ខែ"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm font-bold text-white outline-none focus:border-[#E3B341]/50"
                      />
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-[130px_1fr] gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                        Plan name (EN)
                      </label>
                      <input
                        value={edit.label_en}
                        onChange={(e) => updateEdit(tier.key, 'label_en', e.target.value)}
                        placeholder="e.g. 3 Months"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#E3B341]/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                        ការពិពណ៌នា (ខ្មែរ)
                      </label>
                      <input
                        value={edit.pitch_km}
                        onChange={(e) => updateEdit(tier.key, 'pitch_km', e.target.value)}
                        placeholder="ឧ. ចាប់ផ្តើមមើលភ្លាមៗ — មួយខែពេញ"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#E3B341]/50"
                      />
                    </div>
                  </div>

                  {/* Live preview of the exact line the viewer sees, plus a
                      warning when the name promises a different number of
                      months from the one actually granted. */}
                  <div className="mt-2 rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-white/30">
                      អ្នកទស្សនាឃើញ
                    </p>
                    <p className="mt-0.5 text-xs text-white">
                      <span className="font-bold text-[#E3B341]">${edit.price || '—'}</span>
                      <span className="text-white/40"> · </span>
                      {edit.label_km || '—'}
                      <span className="text-white/40">
                        {' '}— ទទួលបាន {edit.months || '—'} ខែ
                      </span>
                    </p>
                    {mismatch !== null && (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-[#FFB84D]">
                        ⚠️ ឈ្មោះសរសេរ {mismatch} ខែ ប៉ុន្តែផ្ដល់ពិត {edit.months} ខែ —
                        សូមកែឲ្យត្រូវគ្នា មិនដូច្នេះអតិថិជននឹងទទួលខុសពីអ្វីដែលគាត់ឃើញ។
                      </p>
                    )}
                  </div>

                  <div className="mt-2.5">
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-white/40">
                      ABA PayWay link (ជម្រើស — ចុចទូទាត់ភ្លាមៗ)
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={payLinkDrafts[tier.key] ?? ''}
                        onChange={(e) =>
                          setPayLinkDrafts((prev) => ({ ...prev, [tier.key]: e.target.value }))
                        }
                        placeholder="https://link.payway.com.kh/ABAPAY..."
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#E3B341]/50"
                      />
                      <button
                        onClick={() => savePayLink(tier.key)}
                        disabled={savingPayLinkTier === tier.key}
                        className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
                      >
                        {savingPayLinkTier === tier.key ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : payLinkSavedAt[tier.key] && Date.now() - payLinkSavedAt[tier.key] < 2000 ? (
                          <Check className="h-3.5 w-3.5 text-[#34B37A]" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                      ត្រូវជា link ដែលកំណត់ចំនួនទឹកប្រាក់ ${edit.price} ស្រាប់ (Payment Link ចេញពី ABA Merchant
                      សម្រាប់ជម្រើសនេះម្នាក់ៗ) — ទុកទទេបើមិនទាន់មាន នោះ app នឹងបង្ហាញតែ QR ធម្មតា។
                      {payLinks[tier.key] ? ' Link uploaded ✓' : ''}
                    </p>
                  </div>

                  <button
                    onClick={() => toggleBonus(tier.key)}
                    className="mt-2.5 flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <span className="text-xs font-medium text-white/70">Bonus spin ចាប់រង្វាន់</span>
                    <span
                      className={`relative h-5 w-9 rounded-full transition ${
                        edit.bonus_enabled ? 'bg-[#34B37A]' : 'bg-white/15'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                          edit.bonus_enabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </span>
                  </button>

                  {/* One-tap "Open ABA" for viewers depends entirely on this
                      payload existing — an uploaded image that scans fine
                      by eye can still fail automatic decode (logo overlay,
                      odd export size). Surfacing status + a manual paste
                      fallback here means that failure is visible and
                      fixable from the admin side instead of a silently
                      missing button on the viewer's screen. */}
                  <div
                    className={`mt-2.5 rounded-lg border px-3 py-2 ${
                      hasKhqr
                        ? 'border-[#34B37A]/20 bg-[#34B37A]/[0.06]'
                        : 'border-[#FFB84D]/25 bg-[#FFB84D]/[0.06]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`flex items-center gap-1.5 text-[11px] font-semibold ${
                          hasKhqr ? 'text-[#5FD9A0]' : 'text-[#FFB84D]'
                        }`}
                      >
                        {hasKhqr ? (
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        )}
                        {hasKhqr ? 'KHQR ត្រៀមរួច — Open ABA ដំណើរការ' : 'KHQR មិនទាន់មាន — ប៊ូតុង Open ABA នឹងមិនបង្ហាញ'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setKhqrEditingTier(isEditingKhqr ? null : tier.key)}
                        className="shrink-0 text-[11px] font-semibold text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
                      >
                        {isEditingKhqr ? 'បិទ' : hasKhqr ? 'កែ' : 'បិទភ្ជាប់ដោយដៃ'}
                      </button>
                    </div>

                    {/* What the QR itself says, read straight out of the
                        payload — the numbers ABA will actually use. */}
                    {hasKhqr && (
                      <p className="mt-1.5 text-[10px] leading-relaxed text-white/40">
                        ក្នុង QR៖ <span className="font-bold text-white/70">${qrAmount?.toFixed(2) ?? '?'}</span>
                        {qrMerchant ? ` · ${qrMerchant}` : ''}
                      </p>
                    )}
                    {amountMismatch && (
                      <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-[#FF6B6B]/10 px-2 py-1.5 text-[11px] leading-relaxed text-[#FF9C9C]">
                        <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
                        <span>
                          QR យក ${qrAmount?.toFixed(2)} តែតម្លៃក្នុង app ដាក់ ${edit.price} — អតិថិជននឹងបង់តាម QR
                          ហើយការបញ្ជាក់ស្វ័យប្រវត្តិនឹងរង់ចាំលេខមួយទៀត ដូច្នេះគាត់បង់លុយហើយមិនបានVIP។
                          សូមធ្វើ QR ថ្មីតាមតម្លៃនេះ ឬកែតម្លៃឲ្យស្មើ QR។
                        </span>
                      </p>
                    )}

                    {/* A real anchor, so this is testable exactly the way
                        a viewer's phone will meet it. Opening ABA from a
                        genuine link is what works; the copy button is
                        here so the same string can be pasted into a note
                        or sent to a phone for a hands-on check. */}
                    {abaDeeplink && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <a
                          href={abaDeeplink}
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#4A72C4]/25 bg-[#4A72C4]/10 px-2.5 py-1 text-[11px] font-bold text-[#9DBBEE] no-underline transition hover:bg-[#4A72C4]/20"
                        >
                          <Zap className="h-3 w-3" /> សាកល្បងបើក ABA
                        </a>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(abaDeeplink);
                              setCopiedDeeplinkTier(tier.key);
                              window.setTimeout(() => setCopiedDeeplinkTier(null), 2000);
                            } catch {
                              setError('ចម្លងមិនបាន — សូមចម្លងដោយដៃពីប្រអប់ខាងក្រោម។');
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-white/55 transition hover:bg-white/[0.11] hover:text-white/80"
                        >
                          {copiedDeeplinkTier === tier.key ? (
                            <>
                              <Check className="h-3 w-3 text-[#5FD9A0]" /> ចម្លងរួច
                            </>
                          ) : (
                            'ចម្លង deep link'
                          )}
                        </button>
                      </div>
                    )}

                    {isEditingKhqr && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[10px] leading-relaxed text-white/40">
                          ចម្លង KHQR text ពី ABA Business app (មិនមែនរូបភាព) — ចាប់ផ្តើមដោយ 0002 — មកបិទភ្ជាប់ត្រង់នេះ
                          ដើម្បីជួសជុលដោយផ្ទាល់ ក្នុងករណីរូបភាពមិនអាចអានស្វ័យប្រវត្តិបាន។
                        </p>
                        <textarea
                          value={khqrDrafts[tier.key] ?? ''}
                          onChange={(e) =>
                            setKhqrDrafts((prev) => ({ ...prev, [tier.key]: e.target.value }))
                          }
                          placeholder="0002010102..."
                          rows={2}
                          className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-[#34B37A]/50"
                        />
                        <button
                          onClick={() => saveKhqrString(tier.key)}
                          disabled={savingKhqrTier === tier.key}
                          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
                        >
                          {savingKhqrTier === tier.key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          រក្សាទុក
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => saveTier(tier)}
                    disabled={savingTier === tier.key}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-white/10 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
                  >
                    {savingTier === tier.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : savedAt[tier.key] && Date.now() - savedAt[tier.key] < 2000 ? (
                      <Check className="h-3.5 w-3.5 text-[#34B37A]" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save
                  </button>
                </div>
              );
            })}
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />
    </div>
  );
}
