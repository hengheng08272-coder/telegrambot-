import { supabase } from '@/lib/supabase/supabaseClient';
import { md5 } from '@/lib/md5';
import { applyKhqrTemplate, readKhqrField, validateKhqrTemplate } from '@/lib/khqrTemplate';

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
  /**
   * Bank account number, when the account id alone does not identify the
   * account. ABA is the case that matters here: every ABA customer's KHQR
   * carries the SAME account id — `abaakhppxxx@abaa`, which is just ABA's
   * BIC — and the account number sits in this field instead. A QR built
   * from the account id alone would name ABA but no account within it, so
   * for those ids this is the field that actually routes the money.
   *
   * Read it off the owner's own KHQR rather than guessing: long-press the
   * QR in ABA Mobile, and this is the 9 digits after `0109`.
   */
  accountInformation?: string;
  /** Bank name that goes with the above, e.g. `ABA Bank`. */
  acquiringBank?: string;
  /**
   * Registered merchant id, when the owner has a merchant account.
   *
   * This is what decides which KHQR shape gets built, and the difference
   * is not cosmetic. Without it the payload describes an individual
   * (tag 29); with it, a registered merchant (tag 30). ABA accepts a
   * dynamic QR generated outside its own app only in the second form:
   * the first displays correctly, names the right payee and the right
   * amount, and is then refused at the moment of payment with "Invalid Qr
   * Merchant Data".
   *
   * Found in the owner's own fixed-amount ABA QR as the 15 digits after
   * `0115` (see QR_PAYMENT_SETUP_NOTE.md).
   */
  merchantId?: string;
  /**
   * Merchant category code — four digits describing the line of business,
   * assigned by the bank when the merchant account was opened (a
   * streaming service is usually 7832 or 5815). Defaults to the SDK's
   * own value when unset; worth matching to what the bank issued, since
   * that is what it will compare against.
   */
  merchantCategoryCode?: string;
  /**
   * A KHQR the owner's own banking app produced, reused verbatim.
   *
   * This exists because a spec-perfect payload is not always enough. ABA
   * refuses one it did not issue — its QRs carry a proprietary tag 40
   * holding a per-account reference nothing outside ABA can know — so a
   * generated QR displays correctly and is then rejected at payment with
   * "Invalid Qr Merchant Data". Pasting one real QR sidesteps the whole
   * question: per payment only the amount changes, and every field the
   * bank cared about travels through untouched.
   *
   * When set, this wins over every other field here: the SDK is not
   * involved at all.
   */
  khqrTemplate?: string;
}

const SETTING_KEYS = {
  accountId: 'bakong_account_id',
  merchantName: 'bakong_merchant_name',
  city: 'bakong_city',
  accountInformation: 'bakong_account_information',
  acquiringBank: 'bakong_acquiring_bank',
  merchantId: 'bakong_merchant_id',
  merchantCategoryCode: 'bakong_mcc',
  khqrTemplate: 'bakong_khqr_template',
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
    .in('key', Object.values(SETTING_KEYS));
  // The table/rows may not exist on older deploys — treat that as "not
  // configured" rather than an error, exactly like fetchTickerMessage.
  if (error || !data) return null;

  const map = new Map(data.map((row) => [row.key as string, row.value as string]));
  const accountId = (map.get(SETTING_KEYS.accountId) ?? '').trim();
  const merchantName = (map.get(SETTING_KEYS.merchantName) ?? '').trim();
  // City is the one field with a sane default: the spec requires it, but
  // asking an owner to think about it adds nothing.
  const city = (map.get(SETTING_KEYS.city) ?? '').trim() || 'Phnom Penh';
  const accountInformation = (map.get(SETTING_KEYS.accountInformation) ?? '').trim();
  const acquiringBank = (map.get(SETTING_KEYS.acquiringBank) ?? '').trim();

  const khqrTemplate = (map.get(SETTING_KEYS.khqrTemplate) ?? '').trim();

  // Two ways to be configured. A pasted template stands on its own — it
  // already contains the account and the payee name, so neither field is
  // required alongside it. Without one, an account id and a name are
  // both needed: an id with no name shows the payer nothing
  // recognisable, and a name with no id pays nobody.
  if (!khqrTemplate && (!accountId || !merchantName)) return null;
  return {
    accountId,
    merchantName,
    city,
    khqrTemplate: khqrTemplate || undefined,
    accountInformation: accountInformation || undefined,
    acquiringBank: acquiringBank || undefined,
    merchantId: (map.get(SETTING_KEYS.merchantId) ?? '').trim() || undefined,
    merchantCategoryCode: (map.get(SETTING_KEYS.merchantCategoryCode) ?? '').trim() || undefined,
  };
}

/**
 * True when `accountId` names a bank rather than one account inside it, so
 * a QR built from it alone would not reach anybody. ABA is the case in
 * practice: its ids are the bank's BIC (`abaakhppxxx@abaa`), shared by
 * every ABA customer, with the account number carried separately.
 *
 * Used to warn the owner in the admin panel before a member ever scans it.
 */
export function needsAccountInformation(accountId: string, merchantId?: string): boolean {
  // A merchant id identifies the account by itself, in tag 30's own
  // sub-tag, so the individual-account field stops being relevant.
  if (merchantId && merchantId.trim()) return false;
  return /^abaakhpp/i.test(accountId.trim());
}

export async function saveBakongConfig(config: BakongConfig): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('app_settings').upsert([
    { key: SETTING_KEYS.accountId, value: config.accountId.trim(), updated_at: now },
    { key: SETTING_KEYS.merchantName, value: config.merchantName.trim(), updated_at: now },
    { key: SETTING_KEYS.city, value: config.city.trim() || 'Phnom Penh', updated_at: now },
    {
      key: SETTING_KEYS.accountInformation,
      value: (config.accountInformation ?? '').trim(),
      updated_at: now,
    },
    { key: SETTING_KEYS.acquiringBank, value: (config.acquiringBank ?? '').trim(), updated_at: now },
    { key: SETTING_KEYS.merchantId, value: (config.merchantId ?? '').trim(), updated_at: now },
    { key: SETTING_KEYS.khqrTemplate, value: (config.khqrTemplate ?? '').trim(), updated_at: now },
    {
      key: SETTING_KEYS.merchantCategoryCode,
      value: (config.merchantCategoryCode ?? '').trim(),
      updated_at: now,
    },
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
 * Works around a bug in the SDK that only shows up once it is bundled.
 *
 * bakong-khqr's crc16 helper declares `var j, i` and then assigns to a
 * third variable it forgot to declare:
 *
 *     for (i = 0; i < s.length; i++) { c = s[i]; ... }
 *
 * Under Node's CommonJS loader that runs in sloppy mode, so `c` silently
 * becomes a global and everything works — which is why the SDK's own
 * tests pass and why this looks fine from a script. Vite converts the
 * package to an ES module, ES modules are always strict, and assigning to
 * an undeclared name in strict mode throws ReferenceError. The SDK
 * swallows that error and hands it back in place of the payload, so the
 * caller receives an Error object where a string should be.
 *
 * Defining the property up front makes the reference resolvable, so the
 * assignment is legal again and the SDK computes the CRC as intended.
 * Only ever creates it when absent, so nothing else that happens to use a
 * global `c` is disturbed, and it becomes a no-op the day the SDK is
 * fixed upstream.
 *
 * The generated payload is CRC-checked below regardless — this makes the
 * SDK work, and that proves it worked.
 */
function permitSdkImplicitGlobal(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!('c' in g)) g.c = undefined;
}

/** CRC-16/CCITT-FALSE over the payload, the checksum KHQR ends with. */
function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * True when `payload` ends in a checksum that matches its own contents.
 *
 * Computed here rather than taken on trust, because the one thing that
 * must never happen is a payer scanning a QR that encodes something other
 * than the intended payment. A payload that fails this is discarded and
 * the uploaded image is used instead.
 */
function hasValidCrc(payload: string): boolean {
  // ...6304XXXX — the last tag is always the 4-char CRC of everything
  // before it, the "6304" header included.
  if (payload.length < 8 || payload.slice(-8, -4) !== '6304') return false;
  return crc16(payload.slice(0, -4)) === payload.slice(-4);
}

/** Why a generation attempt produced no QR — surfaced in the admin panel. */
export type KhqrFailure =
  | 'bad-amount'
  | 'template-unparseable'
  | 'template-bad-checksum'
  | 'template-static'
  | 'template-name-too-long'
  | 'sdk-rejected'
  | 'sdk-broken'
  | 'invalid-payload'
  | 'sdk-unavailable';

export type GenerateKhqrResult =
  | ({ ok: true } & GeneratedKhqr)
  | { ok: false; reason: KhqrFailure; detail?: string };

/**
 * Builds a fresh KHQR for one payment attempt, reporting why when it
 * cannot. Callers that only need the happy path should use generateKhqr;
 * the admin panel uses this one so the owner is told what went wrong
 * instead of being left with "could not create QR".
 */
export async function generateKhqrDetailed(
  opts: GenerateKhqrOptions,
): Promise<GenerateKhqrResult> {
  const { config, amount, billNumber, storeLabel, expiresInMs = 3 * 60 * 1000 } = opts;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'bad-amount' };

  // Reusing the bank's own payload beats rebuilding one, so it is tried
  // first and the SDK never runs when a template is set.
  if (config.khqrTemplate) {
    const rewritten = applyKhqrTemplate(config.khqrTemplate, {
      amount,
      // Blank means "keep whatever name the bank wrote", which is the
      // only name proven to be accepted until a payment with a replaced
      // one has actually gone through.
      merchantName: config.merchantName || null,
    });
    if (!rewritten.ok) {
      const map = {
        unparseable: 'template-unparseable',
        'bad-checksum': 'template-bad-checksum',
        'no-amount-field': 'template-static',
        'name-too-long': 'template-name-too-long',
      } as const;
      return { ok: false, reason: map[rewritten.reason] };
    }
    return { ok: true, payload: rewritten.payload, md5: md5(rewritten.payload) };
  }

  try {
    const { BakongKHQR, IndividualInfo, MerchantInfo, khqrData } = await import('bakong-khqr');
    permitSdkImplicitGlobal();

    const optional = {
      currency: khqrData.currency.usd,
      // Passed as a string so the cents survive: the SDK writes the value
      // through verbatim, so 1 would emit `54011` where ABA itself emits
      // `54041.00`. Matching the bank's own formatting costs nothing and
      // removes one more way for it to disagree.
      amount: amount.toFixed(2),
      billNumber: billNumber ?? undefined,
      storeLabel: storeLabel ?? undefined,
      expirationTimestamp: Date.now() + expiresInMs,
      merchantCategoryCode: config.merchantCategoryCode || undefined,
    };

    // Two genuinely different payloads, not two ways of writing one.
    // A merchant id means the owner has a registered merchant account,
    // and the QR must describe it as tag 30 — which is the only form ABA
    // will accept from a QR its own app did not generate. Without one the
    // payload describes an individual (tag 29), which is right for a
    // personal Bakong account and refused by ABA for a dynamic QR.
    const result = config.merchantId
      ? new BakongKHQR().generateMerchant(
          new MerchantInfo(
            config.accountId,
            config.merchantName,
            config.city,
            config.merchantId,
            config.acquiringBank || '',
            optional,
          ),
        )
      : new BakongKHQR().generateIndividual(
          new IndividualInfo(config.accountId, config.merchantName, config.city, {
            ...optional,
            // Omitted when blank: passing an empty string would write an
            // empty sub-tag into the payload rather than leaving it out.
            accountInformation: config.accountInformation || undefined,
            acquiringBank: config.acquiringBank || undefined,
          }),
        );

    // The SDK reports failure through a status object instead of throwing.
    if (result?.status && result.status.code !== 0) {
      return { ok: false, reason: 'sdk-rejected', detail: result.status.message ?? undefined };
    }
    const qr: unknown = result?.data?.qr;
    // Checked by type, not truthiness: the SDK returns its own internal
    // errors here, and an Error object is perfectly truthy. That is
    // exactly how a ReferenceError once reached the QR encoder as if it
    // were a payment payload.
    if (typeof qr !== 'string' || !qr) {
      return {
        ok: false,
        reason: 'sdk-broken',
        detail: qr instanceof Error ? qr.message : `payload was ${typeof qr}`,
      };
    }
    if (!hasValidCrc(qr)) return { ok: false, reason: 'invalid-payload' };

    return { ok: true, payload: qr, md5: String(result!.data!.md5) };
  } catch (err) {
    return {
      ok: false,
      reason: 'sdk-unavailable',
      detail: err instanceof Error ? err.message : undefined,
    };
  }
}

/**
 * Builds a fresh KHQR for one payment attempt. Returns null rather than
 * throwing when the SDK rejects the inputs: a failed generation must fall
 * back to the uploaded QR, never leave the viewer with no way to pay.
 */
export async function generateKhqr(opts: GenerateKhqrOptions): Promise<GeneratedKhqr | null> {
  const result = await generateKhqrDetailed(opts);
  return result.ok ? { payload: result.payload, md5: result.md5 } : null;
}

/**
 * Renders a KHQR payload to a PNG data URL so it can be shown as an
 * ordinary <img>. High error correction, because this gets scanned off a
 * phone screen held by someone else's phone.
 */
export async function renderQrDataUrl(payload: string): Promise<string | null> {
  // Guarded because the encoder's own complaint about a non-string is
  // "Invalid data", which says nothing about where the bad value came
  // from. Callers upstream of this have the context; this just refuses.
  if (typeof payload !== 'string' || !payload) return null;
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
