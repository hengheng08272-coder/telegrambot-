import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  QrCode,
  Save,
  ShieldCheck,
  Tag,
  Upload,
  Zap,
} from 'lucide-react';
import AdminPanelShell, { PanelTabs } from '@/components/AdminPanelShell';
import {
  buildAbaDeeplink,
  decodeKhqrFromFile,
  isKhqrPayload,
  readKhqrAmount,
  readKhqrMerchant,
} from '@/lib/khqr';
import { supabase } from '@/lib/supabase/supabaseClient';
import { getHiddenTierKeys, setHiddenTierKeys, PRICING_TIERS } from '@/lib/subscription';
import { fetchAbaMerchantName, saveAbaMerchantName } from '@/lib/api';
import {
  fetchBakongConfig,
  generateKhqrDetailed,
  needsAccountInformation,
  saveBakongConfig,
  renderQrDataUrl,
  type KhqrFailure,
} from '@/lib/bakong';
import { readKhqrField, validateKhqrTemplate, type TemplateFailure } from '@/lib/khqrTemplate';

// Said in the owner's own terms: each one names what to do about it, not
// what the parser objected to.
const TEMPLATE_ERRORS: Record<TemplateFailure, string> = {
  unparseable: 'អានមិនបាន — ច្បាស់ជា copy មិនគ្រប់ សូម copy ម្ដងទៀតទាំងស្រុង',
  'bad-checksum': 'អក្សរខ្វះ ឬលើស — សូម copy ទាំងមូលម្ដងទៀត កុំកែដោយដៃ',
  'no-amount-field': 'QR នេះមិនមានចំនួនទឹកប្រាក់ទេ — ត្រូវបង្កើត QR ដែលដាក់ចំនួនស្រាប់',
  'name-too-long': 'ឈ្មោះវែងពេក (លើសពី ២៥ តួ)',
};

interface Props {
  onClose: () => void;
}

// The panel used to stack every job onto one card: pricing, the QR
// image, the KHQR payload, the PayWay link and the auto-confirm
// merchant name, all at once. Splitting them means each visit is about
// one thing, and the fields for that one thing are the only ones on
// screen.
type Section = 'plans' | 'qr' | 'auto';

const SECTION_SUBTITLE: Record<Section, string> = {
  plans: 'តម្លៃ · រយៈពេល (ខែ) · ឈ្មោះគម្រោង · ការពិពណ៌នា · Bonus spin',
  qr: 'រូប KHQR · KHQR text (Open ABA) · ABA PayWay link',
  auto: 'ឈ្មោះគណនី ABA និងតារាងផ្គូផ្គងតម្លៃ→គម្រោង',
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
  const [section, setSection] = useState<Section>('plans');
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

  // ABA auto-confirm matching — the name printed on every real ABA
  // notification for this account, used by the aba-payment-webhook
  // function to make sure a stray/unrelated group message can never be
  // mistaken for a real payment. Everything else about auto-confirm
  // (which amounts are valid, which tier they map to) already comes from
  // the pricing_tiers table above — this is the one extra piece of admin
  // config auto-confirm needs.
  // Which plans are currently withheld from the viewer's picker.
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [hiddenBusyTier, setHiddenBusyTier] = useState<string | null>(null);
  const [abaMerchantName, setAbaMerchantName] = useState('');
  const [abaMerchantNameLoaded, setAbaMerchantNameLoaded] = useState(false);
  // Bakong KHQR: the app generates its own payment QR from these, so the
  // name a member sees while paying is this app's, not whoever's picture
  // happened to be uploaded.
  const [bakongAccountId, setBakongAccountId] = useState('');
  const [bakongName, setBakongName] = useState('');
  const [bakongCity, setBakongCity] = useState('Phnom Penh');
  const [bakongAccountNumber, setBakongAccountNumber] = useState('');
  const [bakongBank, setBakongBank] = useState('');
  const [bakongMerchantId, setBakongMerchantId] = useState('');
  const [bakongMcc, setBakongMcc] = useState('');
  const [bakongTemplate, setBakongTemplate] = useState('');
  const [bakongSaving, setBakongSaving] = useState(false);
  const [bakongSaved, setBakongSaved] = useState(false);
  const [bakongPreview, setBakongPreview] = useState<string | null>(null);
  const [bakongPreviewError, setBakongPreviewError] = useState('');
  const [abaSaving, setAbaSaving] = useState(false);
  const [abaSaved, setAbaSaved] = useState(false);

  useEffect(() => {
    fetchBakongConfig().then((cfg) => {
      if (!cfg) return;
      setBakongAccountId(cfg.accountId);
      setBakongName(cfg.merchantName);
      setBakongCity(cfg.city);
      setBakongAccountNumber(cfg.accountInformation ?? '');
      setBakongBank(cfg.acquiringBank ?? '');
      setBakongMerchantId(cfg.merchantId ?? '');
      setBakongMcc(cfg.merchantCategoryCode ?? '');
      setBakongTemplate(cfg.khqrTemplate ?? '');
    });
    fetchAbaMerchantName().then((name) => {
      if (name) setAbaMerchantName(name);
      setAbaMerchantNameLoaded(true);
    });
  }, []);

  // Renders a sample $1 QR from whatever is typed in, so the owner can
  // scan it with their own banking app and confirm two things before any
  // member ever sees it: the money lands in the right account, and the
  // name shown is the one they want.
  const templateCheck = validateKhqrTemplate(bakongTemplate);

  const handlePreviewBakong = async () => {
    setBakongPreview(null);
    setBakongPreviewError('');
    const config = {
      accountId: bakongAccountId.trim(),
      merchantName: bakongName.trim(),
      city: bakongCity.trim() || 'Phnom Penh',
      accountInformation: bakongAccountNumber.trim() || undefined,
      acquiringBank: bakongBank.trim() || undefined,
      merchantId: bakongMerchantId.trim() || undefined,
      merchantCategoryCode: bakongMcc.trim() || undefined,
      khqrTemplate: bakongTemplate.trim() || undefined,
    };
    if (!config.khqrTemplate && (!config.accountId || !config.merchantName)) {
      setBakongPreviewError('ត្រូវការ Account ID និងឈ្មោះ (ឬបិទភ្ជាប់ KHQR ខាងលើ)');
      return;
    }
    // An ABA-style id names the bank, not an account inside it. Generating
    // anyway would produce a QR that scans cleanly and reaches nobody, so
    // this stops before the owner can mistake a valid-looking preview for
    // a working one.
    if (
      !config.khqrTemplate &&
      needsAccountInformation(config.accountId, config.merchantId) &&
      !config.accountInformation
    ) {
      setBakongPreviewError('ត្រូវការលេខគណនី (Account number) សម្រាប់ ABA');
      return;
    }
    const generated = await generateKhqrDetailed({ config, amount: 1, storeLabel: 'PREVIEW' });
    if (!generated.ok) {
      // Every branch says something the owner can act on. "Could not
      // create QR" for all of them is what turned a one-line SDK bug into
      // a setup screen nobody could get past.
      const reasons: Record<KhqrFailure, string> = {
        'bad-amount': 'តម្លៃមិនត្រឹមត្រូវ',
        'sdk-rejected': 'ព័ត៌មានមិនត្រឹមត្រូវ — សូមពិនិត្យ Account ID (ទម្រង់ត្រូវជា name@bank)',
        'sdk-broken': 'Bakong SDK មានបញ្ហា — សូមប្រាប់ dev',
        'invalid-payload': 'QR ដែលបង្កើតខូច (CRC មិនត្រូវ) — សូមប្រាប់ dev',
        'sdk-unavailable': 'ផ្ទុក Bakong SDK មិនបាន — សូមពិនិត្យ internet រួចព្យាយាមម្ដងទៀត',
        'template-unparseable': TEMPLATE_ERRORS.unparseable,
        'template-bad-checksum': TEMPLATE_ERRORS['bad-checksum'],
        'template-static': TEMPLATE_ERRORS['no-amount-field'],
        'template-name-too-long': TEMPLATE_ERRORS['name-too-long'],
      };
      setBakongPreviewError(
        reasons[generated.reason] + (generated.detail ? ` (${generated.detail})` : ''),
      );
      return;
    }
    const image = await renderQrDataUrl(generated.payload);
    if (!image) {
      setBakongPreviewError('មិនអាចបង្កើតរូប QR បានទេ');
      return;
    }
    setBakongPreview(image);
  };

  // Turning this OFF has to be as easy as turning it on. Save is
  // deliberately blocked while the account id is empty (an id-less config
  // generates QRs that reach nobody), which left no way back to the
  // uploaded images once a config was stored — the setting could be
  // enabled but not disabled. This clears all five keys, and
  // fetchBakongConfig's "no account id means not configured" rule does
  // the rest.
  const handleDisableBakong = async () => {
    setBakongSaving(true);
    setBakongSaved(false);
    setBakongPreview(null);
    setBakongPreviewError('');
    try {
      await saveBakongConfig({ accountId: '', merchantName: '', city: '' });
      setBakongAccountId('');
      setBakongName('');
      setBakongCity('Phnom Penh');
      setBakongAccountNumber('');
      setBakongBank('');
      setBakongMerchantId('');
      setBakongMcc('');
      setBakongTemplate('');
      setBakongSaved(true);
      window.setTimeout(() => setBakongSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not clear Bakong settings');
    } finally {
      setBakongSaving(false);
    }
  };

  const handleSaveBakong = async () => {
    setBakongSaving(true);
    setBakongSaved(false);
    try {
      await saveBakongConfig({
        accountId: bakongAccountId,
        merchantName: bakongName,
        city: bakongCity,
        accountInformation: bakongAccountNumber,
        acquiringBank: bakongBank,
        merchantId: bakongMerchantId,
        merchantCategoryCode: bakongMcc,
        khqrTemplate: bakongTemplate,
      });
      setBakongSaved(true);
      window.setTimeout(() => setBakongSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save Bakong settings');
    } finally {
      setBakongSaving(false);
    }
  };

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

  // A plan can be priced, named and given a QR and still never appear to
  // anyone, so this has to be visible and switchable right next to the
  // fields that configure it.
  const toggleVisible = async (tierKey: string) => {
    setHiddenBusyTier(tierKey);
    const next = new Set(hiddenKeys);
    if (next.has(tierKey)) next.delete(tierKey);
    else next.add(tierKey);
    try {
      await setHiddenTierKeys(next);
      setHiddenKeys(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to change plan visibility');
    } finally {
      setHiddenBusyTier(null);
    }
  };

  const load = async () => {
    setLoading(true);
    getHiddenTierKeys().then(setHiddenKeys);
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
    <AdminPanelShell
      title="Subscriptions"
      subtitle={SECTION_SUBTITLE[section]}
      icon={<QrCode className="h-4 w-4" />}
      accent="#F5C563"
      maxWidth="max-w-6xl"
      error={error}
      onDismissError={() => setError('')}
      onClose={onClose}
      toolbar={
        <PanelTabs<Section>
          active={section}
          onChange={setSection}
          tabs={[
            { key: 'plans', label: 'គម្រោង & តម្លៃ', icon: <Tag className="h-3.5 w-3.5" /> },
            { key: 'qr', label: 'QR & Deep link', icon: <QrCode className="h-3.5 w-3.5" /> },
            { key: 'auto', label: 'ABA Auto-confirm', icon: <Zap className="h-3.5 w-3.5" /> },
          ]}
        />
      }
    >
      {section === 'qr' && (
        <div className="mb-5 rounded-xl border border-[#2FD98C]/25 bg-[#2FD98C]/[0.04] p-4">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#2FD98C]">
            <QrCode className="h-3.5 w-3.5" /> Bakong KHQR — បង្កើត QR ដោយស្វ័យប្រវត្តិ
          </p>
          <p className="mb-3 max-w-2xl text-[11px] leading-relaxed text-white/50">
            ពេលបំពេញប្រអប់ខាងក្រោម កម្មវិធីនឹង<b className="text-white/70">បង្កើត QR ថ្មីរៀងៗខ្លួន</b>សម្រាប់ការទូទាត់
            និមួយៗ — ក្រោមឈ្មោះរបស់អ្នក ជាមួយតម្លៃគម្រោងជាប់ស្រាប់ និងផុតកំណត់ ៣ នាទី។ សមាជិកនឹងឃើញ
            ឈ្មោះនេះក្នុង App ធនាគាររបស់គេ ដែលធ្វើឲ្យគេជឿជាក់ថាបង់ត្រូវកន្លែង។ បើទុកទទេ
            កម្មវិធីប្រើរូប QR ដែលអ្នក upload ដូចធម្មតា។
          </p>
          {/* Put first because it supersedes everything under it. A
              payload the bank itself issued needs no reconstruction, and
              reconstruction is where ABA rejects us. */}
          <div className="mb-3 rounded-lg border border-white/10 bg-black/20 p-3">
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[#2FD98C]">
              ★ វិធីងាយបំផុត — បិទភ្ជាប់ KHQR ពីធនាគាររបស់អ្នក
            </label>
            <p className="mb-2 text-[11px] leading-relaxed text-white/50">
              បង្កើត QR ណាមួយ<b className="text-white/70">ដែលមានចំនួនទឹកប្រាក់</b>ក្នុង App ធនាគាររបស់អ្នក →
              ចុចឲ្យជាប់លើ QR → Copy → បិទភ្ជាប់ទីនេះ។ កម្មវិធីនឹងប្ដូរតែ
              <b className="text-white/70">ចំនួនទឹកប្រាក់</b>ប៉ុណ្ណោះ រីឯផ្នែកឯទៀតរក្សាដដែលបេះបិទ —
              ដូច្នេះធនាគារទទួលស្គាល់វាដូច QR ខ្លួនឯង។ បើបំពេញប្រអប់នេះ ប្រអប់ខាងក្រោមមិនប្រើទេ។
            </p>
            <textarea
              value={bakongTemplate}
              onChange={(e) => setBakongTemplate(e.target.value)}
              placeholder="00020101021229450016..."
              rows={3}
              className="w-full resize-y rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-white outline-none focus:border-[#2FD98C]/50"
            />
            {bakongTemplate.trim() && (
              <div className="mt-1.5 text-[11px] font-semibold">
                {templateCheck.ok ? (
                  <>
                    <p className="text-[#2FD98C]">✓ KHQR ត្រឹមត្រូវ</p>
                    {/* Two different names, and confusing them is easy: one
                        is what the bank wrote in the paste, the other is
                        what this app will actually put in the QR it hands
                        a member. Showing only the first made an applied
                        override look like it had done nothing. */}
                    <p className="mt-1 font-normal text-white/45">
                      ឈ្មោះក្នុង QR ដែល paste៖{' '}
                      <b className="text-white/70">
                        {readKhqrField(bakongTemplate.trim(), '59') ?? '—'}
                      </b>
                    </p>
                    <p className="mt-0.5 font-normal text-white/45">
                      ឈ្មោះដែលសមាជិកនឹងឃើញ៖{' '}
                      {bakongName.trim() ? (
                        <b className="text-[#2FD98C]">{bakongName.trim()}</b>
                      ) : (
                        <>
                          <b className="text-white/70">
                            {readKhqrField(bakongTemplate.trim(), '59') ?? '—'}
                          </b>
                          <span className="text-white/35">
                            {' '}
                            — បំពេញ «ឈ្មោះបង្ហាញ» ខាងក្រោម ដើម្បីប្ដូរ
                          </span>
                        </>
                      )}
                    </p>
                  </>
                ) : (
                  <span className="text-[#FF6B60]">{TEMPLATE_ERRORS[templateCheck.reason]}</span>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
                Bakong Account ID
              </label>
              <input
                value={bakongAccountId}
                onChange={(e) => setBakongAccountId(e.target.value)}
                placeholder="ឧ. nintanime@aba"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2FD98C]/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
                ឈ្មោះបង្ហាញ
                {bakongTemplate.trim() && (
                  <span className="ml-1 normal-case text-white/30">(ទុកទទេ = ឈ្មោះធនាគារ)</span>
                )}
              </label>
              <input
                value={bakongName}
                onChange={(e) => setBakongName(e.target.value)}
                placeholder="ឧ. NINT ANIME"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2FD98C]/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
                ទីក្រុង
              </label>
              <input
                value={bakongCity}
                onChange={(e) => setBakongCity(e.target.value)}
                placeholder="Phnom Penh"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2FD98C]/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
                លេខគណនី {needsAccountInformation(bakongAccountId, bakongMerchantId) && <span className="text-[#FF6B60]">*</span>}
              </label>
              <input
                value={bakongAccountNumber}
                onChange={(e) => setBakongAccountNumber(e.target.value)}
                placeholder="ឧ. 001234567"
                inputMode="numeric"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2FD98C]/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
                ធនាគារ
              </label>
              <input
                value={bakongBank}
                onChange={(e) => setBakongBank(e.target.value)}
                placeholder="ឧ. ABA Bank"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2FD98C]/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
                Merchant ID
              </label>
              <input
                value={bakongMerchantId}
                onChange={(e) => setBakongMerchantId(e.target.value)}
                placeholder="ឧ. 126080203472538"
                inputMode="numeric"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2FD98C]/50"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
                MCC
              </label>
              <input
                value={bakongMcc}
                onChange={(e) => setBakongMcc(e.target.value)}
                placeholder="ឧ. 7832"
                inputMode="numeric"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2FD98C]/50"
              />
            </div>
          </div>
          {/* The one field that decides whether ABA will accept the QR at
              all. Without it the payload describes an individual, which
              ABA displays correctly and then refuses to pay. */}
          {!bakongMerchantId.trim() && !bakongTemplate.trim() && (
            <p className="mt-2 rounded-lg border border-[#FFC55A]/25 bg-[#FFC55A]/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-[#FFC55A]">
              បើគណនីរបស់អ្នកជា <b>ABA merchant</b> ត្រូវបំពេញ <b>Merchant ID</b> ជាដាច់ខាត។ បើគ្មានវាទេ
              ABA នឹងបង្ហាញ QR ត្រឹមត្រូវ តែពេលចុចបង់ វានឹងបដិសេធថា{' '}
              <code>Invalid Qr Merchant Data</code>។ រកលេខ ១៥ ខ្ទង់នោះបានពី KHQR ដែល ABA បង្កើតឲ្យអ្នក
              (លេខបន្ទាប់ពី <code>0115</code>)។
            </p>
          )}
          {/* An ABA id is the bank's BIC, shared by every ABA customer, so
              on its own it reaches no account at all. Say so at the moment
              the owner pastes one, not after a member has paid. */}
          {!bakongTemplate.trim() &&
            needsAccountInformation(bakongAccountId, bakongMerchantId) &&
            !bakongAccountNumber.trim() && (
            <p className="mt-2 rounded-lg border border-[#FFC55A]/25 bg-[#FFC55A]/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-[#FFC55A]">
              Account ID របស់ ABA (<code>abaakhppxxx@abaa</code>) គឺជាឈ្មោះ<b>ធនាគារ</b> មិនមែនគណនីអ្នកទេ —
              អ្នកប្រើ ABA គ្រប់រូបមានលេខដូចគ្នា។ ត្រូវបំពេញ <b>លេខគណនី</b> ផង បើមិនដូច្នេះទេ QR ស្កេនចូល
              តែលុយមិនចូលគណនីណាឡើយ។ លេខនោះជាលេខ ៩ ខ្ទង់បន្ទាប់ពី <code>0109</code> ក្នុង KHQR របស់អ្នក។
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={handlePreviewBakong}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold text-white/80 transition hover:bg-white/10"
            >
              <QrCode className="h-3.5 w-3.5" /> សាកមើល ($1)
            </button>
            <button
              onClick={handleSaveBakong}
              disabled={
                bakongSaving ||
                // A pasted template carries the account and the payee name
                // itself, so it is a complete configuration on its own —
                // and it bypasses the SDK, so the account-number rule
                // below cannot apply to it either. Everything else here
                // only matters when there is no template.
                (!bakongTemplate.trim() &&
                  (!bakongAccountId.trim() ||
                    !bakongName.trim() ||
                    // Saving an ABA id with no account number would switch
                    // every tier over to a QR that reaches nobody, so it
                    // stays blocked rather than merely warned about.
                    (needsAccountInformation(bakongAccountId, bakongMerchantId) &&
                      !bakongAccountNumber.trim())))
              }
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
            >
              {bakongSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : bakongSaved ? (
                <Check className="h-3.5 w-3.5 text-[#2FD98C]" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {bakongSaved ? 'Saved' : 'Save'}
            </button>
            <button
              onClick={handleDisableBakong}
              disabled={bakongSaving}
              className="flex items-center gap-1.5 rounded-xl border border-[#FF6B60]/25 bg-[#FF6B60]/[0.06] px-3 py-1.5 text-xs font-bold text-[#FF6B60] transition hover:bg-[#FF6B60]/10 disabled:opacity-50"
            >
              បិទ / ត្រឡប់ទៅរូប QR upload
            </button>
            {bakongPreviewError && (
              <span className="text-[11px] font-semibold text-[#FF6B60]">{bakongPreviewError}</span>
            )}
          </div>
          {bakongPreview && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
              <img src={bakongPreview} alt="KHQR preview" className="h-28 w-28 rounded-lg bg-white p-1" />
              <p className="text-[11px] leading-relaxed text-white/60">
                ស្កេន QR នេះដោយ App ធនាគាររបស់អ្នក ដើម្បីពិនិត្យថា <b className="text-white/80">ឈ្មោះ</b> និង
                <b className="text-white/80"> គណនី</b> ត្រឹមត្រូវ។ នេះជា QR សាកល្បង $1 — កុំបង់ប្រាក់។
              </p>
            </div>
          )}
        </div>
      )}

      {section === 'auto' && (
        <>
          <div className="mb-5 rounded-xl border border-[#4C6FFF]/20 bg-[#4C6FFF]/[0.04] p-4">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#4C6FFF]">
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
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#4C6FFF]/50"
              />
              <button
                onClick={handleSaveAbaMerchantName}
                disabled={abaSaving || !abaMerchantName.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
              >
                {abaSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : abaSaved ? (
                  <Check className="h-3.5 w-3.5 text-[#2FD98C]" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {abaSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>

          {/* Auto-confirm matches an incoming ABA alert to a plan by its
              amount and nothing else, so two plans sharing a price is
              not a cosmetic problem: the webhook cannot tell which one
              was bought and refuses the match outright. This table is
              the only place that rule is visible before it bites. */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">
              តារាងផ្គូផ្គង៖ ទឹកប្រាក់ → គម្រោង
            </p>
            <div className="space-y-1.5">
              {PRICING_TIERS.map((tier) => {
                const edit = edits[tier.key];
                if (!edit) return null;
                const clash = PRICING_TIERS.some(
                  (other) =>
                    other.key !== tier.key &&
                    edits[other.key] &&
                    parseFloat(edits[other.key].price) === parseFloat(edit.price),
                );
                return (
                  <div
                    key={tier.key}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${
                      clash
                        ? 'border-[#FF6B60]/30 bg-[#FF6B60]/[0.07]'
                        : 'border-white/[0.07] bg-black/20'
                    }`}
                  >
                    <span className="w-16 shrink-0 font-bold text-[#F5C563]">${edit.price || '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-white/70">
                      {edit.label_km.trim() || edit.label_en.trim() || tier.key} · {edit.months || '—'} ខែ
                    </span>
                    {clash ? (
                      <span className="shrink-0 text-[11px] font-semibold text-[#FFA8B2]">
                        តម្លៃដូចគ្នា — auto-confirm នឹងបដិសេធ
                      </span>
                    ) : (
                      <Check className="h-3.5 w-3.5 shrink-0 text-[#2FD98C]" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {section !== 'auto' &&
        (loading ? (
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
              const qr = images[tier.key] ?? null;
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
                        <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-white/35">
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
                    {section === 'qr' && (
                    <button
                      onClick={() => triggerUpload(tier.key)}
                      disabled={uploadingTier === tier.key}
                      className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#F5C563]/30 bg-[#F5C563]/10 px-3 py-1.5 text-xs font-bold text-[#F5C563] transition hover:bg-[#F5C563]/20 disabled:opacity-50"
                    >
                      {uploadingTier === tier.key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {qr ? 'Replace' : 'Upload'}
                    </button>
                    )}
                  </div>

                  {section === 'plans' && (
                  <>
                  <div className="grid grid-cols-[76px_76px_1fr] gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-white/40">
                        តម្លៃ ($)
                      </label>
                      <input
                        inputMode="decimal"
                        value={edit.price}
                        onChange={(e) => updateEdit(tier.key, 'price', e.target.value.replace(/[^0-9.]/g, ''))}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm font-bold text-white outline-none focus:border-[#F5C563]/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-white/40">
                        រយៈពេល (ខែ)
                      </label>
                      <input
                        inputMode="numeric"
                        value={edit.months}
                        onChange={(e) => updateEdit(tier.key, 'months', e.target.value.replace(/[^0-9]/g, ''))}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm font-bold text-white outline-none focus:border-[#4C6FFF]/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-white/40">
                        ឈ្មោះគម្រោង (ខ្មែរ)
                      </label>
                      <input
                        value={edit.label_km}
                        onChange={(e) => updateEdit(tier.key, 'label_km', e.target.value)}
                        placeholder="ឧ. ៣ ខែ"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm font-bold text-white outline-none focus:border-[#F5C563]/50"
                      />
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-[130px_1fr] gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-white/40">
                        Plan name (EN)
                      </label>
                      <input
                        value={edit.label_en}
                        onChange={(e) => updateEdit(tier.key, 'label_en', e.target.value)}
                        placeholder="e.g. 3 Months"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#F5C563]/50"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-white/40">
                        ការពិពណ៌នា (ខ្មែរ)
                      </label>
                      <input
                        value={edit.pitch_km}
                        onChange={(e) => updateEdit(tier.key, 'pitch_km', e.target.value)}
                        placeholder="ឧ. ចាប់ផ្តើមមើលភ្លាមៗ — មួយខែពេញ"
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#F5C563]/50"
                      />
                    </div>
                  </div>

                  {/* Live preview of the exact line the viewer sees, plus a
                      warning when the name promises a different number of
                      months from the one actually granted. */}
                  <div className="mt-2 rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-white/30">
                      អ្នកទស្សនាឃើញ
                    </p>
                    <p className="mt-0.5 text-xs text-white">
                      <span className="font-bold text-[#F5C563]">${edit.price || '—'}</span>
                      <span className="text-white/40"> · </span>
                      {edit.label_km || '—'}
                      <span className="text-white/40">
                        {' '}— ទទួលបាន {edit.months || '—'} ខែ
                      </span>
                    </p>
                    {mismatch !== null && (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-[#FFC24D]">
                        ⚠️ ឈ្មោះសរសេរ {mismatch} ខែ ប៉ុន្តែផ្ដល់ពិត {edit.months} ខែ —
                        សូមកែឲ្យត្រូវគ្នា មិនដូច្នេះអតិថិជននឹងទទួលខុសពីអ្វីដែលគាត់ឃើញ។
                      </p>
                    )}
                  </div>
                  </>
                  )}

                  {section === 'qr' && (
                  <div className="mt-2.5">
                    <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-white/40">
                      ABA PayWay link (ជម្រើស — ចុចទូទាត់ភ្លាមៗ)
                    </label>
                    <div className="flex gap-2">
                      <input
                        value={payLinkDrafts[tier.key] ?? ''}
                        onChange={(e) =>
                          setPayLinkDrafts((prev) => ({ ...prev, [tier.key]: e.target.value }))
                        }
                        placeholder="https://link.payway.com.kh/ABAPAY..."
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#F5C563]/50"
                      />
                      <button
                        onClick={() => savePayLink(tier.key)}
                        disabled={savingPayLinkTier === tier.key}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
                      >
                        {savingPayLinkTier === tier.key ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : payLinkSavedAt[tier.key] && Date.now() - payLinkSavedAt[tier.key] < 2000 ? (
                          <Check className="h-3.5 w-3.5 text-[#2FD98C]" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-white/35">
                      ត្រូវជា link ដែលកំណត់ចំនួនទឹកប្រាក់ ${edit.price} ស្រាប់ (Payment Link ចេញពី ABA Merchant
                      សម្រាប់ជម្រើសនេះម្នាក់ៗ) — ទុកទទេបើមិនទាន់មាន នោះ app នឹងបង្ហាញតែ QR ធម្មតា។
                      {payLinks[tier.key] ? ' Link uploaded ✓' : ''}
                    </p>
                  </div>
                  )}

                  {section === 'plans' && (
                  <button
                    type="button"
                    onClick={() => toggleVisible(tier.key)}
                    disabled={hiddenBusyTier === tier.key}
                    className={`mt-2.5 flex w-full items-center justify-between rounded-lg border px-3 py-2 disabled:opacity-50 ${
                      hiddenKeys.has(tier.key)
                        ? 'border-[#FFC24D]/30 bg-[#FFC24D]/[0.07]'
                        : 'border-white/10 bg-black/20'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-white/70">
                      {hiddenKeys.has(tier.key) ? (
                        <EyeOff className="h-3.5 w-3.5 text-[#FFC24D]" />
                      ) : (
                        <Eye className="h-3.5 w-3.5 text-[#2FD98C]" />
                      )}
                      {hiddenKeys.has(tier.key) ? 'លាក់ — អតិថិជនមិនឃើញ' : 'បង្ហាញក្នុង app'}
                    </span>
                    <span
                      className={`relative h-5 w-9 rounded-full transition ${
                        hiddenKeys.has(tier.key) ? 'bg-white/15' : 'bg-[#2FD98C]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                          hiddenKeys.has(tier.key) ? 'left-0.5' : 'left-[18px]'
                        }`}
                      />
                    </span>
                  </button>
                  )}

                  {section === 'plans' && (
                  <button
                    onClick={() => toggleBonus(tier.key)}
                    className="mt-2.5 flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <span className="text-xs font-medium text-white/70">Bonus spin ចាប់រង្វាន់</span>
                    <span
                      className={`relative h-5 w-9 rounded-full transition ${
                        edit.bonus_enabled ? 'bg-[#2FD98C]' : 'bg-white/15'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                          edit.bonus_enabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </span>
                  </button>
                  )}

                  {section === 'qr' && (
                  /* One-tap "Open ABA" for viewers depends entirely on this
                      payload existing — an uploaded image that scans fine
                      by eye can still fail automatic decode (logo overlay,
                      odd export size). Surfacing status + a manual paste
                      fallback here means that failure is visible and
                      fixable from the admin side instead of a silently
                      missing button on the viewer's screen. */
                  <div
                    className={`mt-2.5 rounded-lg border px-3 py-2 ${
                      hasKhqr
                        ? 'border-[#2FD98C]/20 bg-[#2FD98C]/[0.06]'
                        : 'border-[#FFC24D]/25 bg-[#FFC24D]/[0.06]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`flex items-center gap-1.5 text-[11px] font-semibold ${
                          hasKhqr ? 'text-[#2FD98C]' : 'text-[#FFC24D]'
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
                      <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
                        ក្នុង QR៖ <span className="font-bold text-white/70">${qrAmount?.toFixed(2) ?? '?'}</span>
                        {qrMerchant ? ` · ${qrMerchant}` : ''}
                      </p>
                    )}
                    {amountMismatch && (
                      <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-[#FF6B60]/10 px-2 py-1.5 text-[11px] leading-relaxed text-[#FFA8B2]">
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
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#6B85FF]/25 bg-[#6B85FF]/10 px-2.5 py-1 text-[11px] font-bold text-[#B6C3FF] no-underline transition hover:bg-[#6B85FF]/20"
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
                              <Check className="h-3 w-3 text-[#2FD98C]" /> ចម្លងរួច
                            </>
                          ) : (
                            'ចម្លង deep link'
                          )}
                        </button>
                      </div>
                    )}

                    {/* The link itself, underlined and wrapped — the same
                        form it takes in a notes app, where a URL in plain
                        text is auto-detected and styled. A web page never
                        does that on its own: text is only a link when it
                        is wrapped in an <a href>, so it is rendered that
                        way here deliberately, to be checked and copied. */}
                    {abaDeeplink && (
                      <a
                        href={abaDeeplink}
                        rel="noreferrer"
                        className="mt-2 block break-all rounded-lg bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed text-[#B6C3FF] underline decoration-[#B6C3FF]/50 underline-offset-2"
                      >
                        {abaDeeplink}
                      </a>
                    )}

                    {isEditingKhqr && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[11px] leading-relaxed text-white/40">
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
                          className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-[#2FD98C]/50"
                        />
                        <button
                          onClick={() => saveKhqrString(tier.key)}
                          disabled={savingKhqrTier === tier.key}
                          className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
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
                  )}

                  {section === 'plans' && (
                  <button
                    onClick={() => saveTier(tier)}
                    disabled={savingTier === tier.key}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-white/10 py-2 text-xs font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
                  >
                    {savingTier === tier.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : savedAt[tier.key] && Date.now() - savedAt[tier.key] < 2000 ? (
                      <Check className="h-3.5 w-3.5 text-[#2FD98C]" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    រក្សាទុកគម្រោង
                  </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}

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
