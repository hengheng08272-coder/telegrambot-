// =====================================================================
// KHQR payload surgery
//
// Some banks will not accept a payload that a third party assembled from
// scratch, even a spec-perfect one. ABA is the case this was written
// for: its own QRs carry a proprietary tag 40 (`abaP2P`, holding a
// per-account reference the SDK has no way to know), and without it ABA
// renders the QR correctly, names the right payee and the right amount,
// and then refuses at the moment of payment with "Invalid Qr Merchant
// Data".
//
// So this stops trying to reproduce the bank's payload and reuses it
// instead. The owner pastes ONE QR their own banking app generated; per
// payment the amount is swapped and the checksum recomputed. Everything
// the bank cared about — account template, proprietary tags, merchant
// category, the lot — travels through untouched, byte for byte, because
// it is never rebuilt.
//
// The happy side effect is that this is bank-agnostic: it never needs to
// know what any particular bank puts in its payloads.
// =====================================================================

export interface KhqrField {
  tag: string;
  value: string;
}

/**
 * Splits an EMVCo payload into its top-level tag/value pairs.
 *
 * Returns null on anything that does not parse cleanly rather than
 * throwing or half-reading it — a malformed template must be rejected at
 * setup time, not turned into a subtly wrong QR at payment time.
 */
export function parseKhqr(payload: string): KhqrField[] | null {
  const fields: KhqrField[] = [];
  let i = 0;
  while (i < payload.length) {
    // Every field is 2-char tag + 2-digit length + value.
    if (i + 4 > payload.length) return null;
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(payload.slice(i + 2, i + 4)) || !Number.isFinite(len)) return null;
    if (i + 4 + len > payload.length) return null;
    fields.push({ tag, value: payload.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return fields.length ? fields : null;
}

export function serialiseKhqr(fields: KhqrField[]): string {
  return fields
    .map(({ tag, value }) => `${tag}${String(value.length).padStart(2, '0')}${value}`)
    .join('');
}

/** CRC-16/CCITT-FALSE — the checksum KHQR carries in tag 63. */
export function khqrCrc(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** True when a payload's trailing checksum matches its own contents. */
export function hasValidKhqrCrc(payload: string): boolean {
  if (payload.length < 8 || payload.slice(-8, -4) !== '63') {
    // tag 63 is always last, always length 04.
    if (payload.length < 8 || payload.slice(-8, -4) !== '6304') return false;
  }
  return khqrCrc(payload.slice(0, -4)) === payload.slice(-4).toUpperCase();
}

const TAG_AMOUNT = '54';
const TAG_MERCHANT_NAME = '59';
const TAG_CRC = '63';
const TAG_POINT_OF_INITIATION = '01';

export type TemplateFailure =
  | 'unparseable'
  | 'bad-checksum'
  | 'no-amount-field'
  | 'name-too-long';

export type TemplateResult =
  | { ok: true; payload: string }
  | { ok: false; reason: TemplateFailure };

/**
 * Checks a pasted payload is a KHQR this app can safely reuse.
 *
 * The checksum test is the important one: it proves the paste is
 * complete and untruncated, which a payload copied out of a phone's
 * long-press menu very easily is not.
 */
export function validateKhqrTemplate(payload: string): TemplateResult {
  const trimmed = payload.trim();
  const fields = parseKhqr(trimmed);
  if (!fields) return { ok: false, reason: 'unparseable' };
  if (!hasValidKhqrCrc(trimmed)) return { ok: false, reason: 'bad-checksum' };
  // A template without an amount field is a static QR — the payer types
  // the amount themselves, which is exactly what this app exists to stop.
  if (!fields.some((f) => f.tag === TAG_AMOUNT)) return { ok: false, reason: 'no-amount-field' };
  return { ok: true, payload: trimmed };
}

export interface TemplateOverrides {
  /** Price for this payment, replacing whatever the template carried. */
  amount: number;
  /**
   * Name to show the payer. Left alone when omitted — the bank's own
   * name for the account is the safest default, and the only one proven
   * to be accepted until a payment with a replaced name has gone
   * through.
   */
  merchantName?: string | null;
}

/**
 * Rewrites a bank-issued KHQR for one payment.
 *
 * Only the fields named here are touched; every other field, including
 * any the spec does not describe, is carried across exactly as the bank
 * wrote it. The checksum is recomputed last, over the result.
 */
export function applyKhqrTemplate(
  template: string,
  { amount, merchantName }: TemplateOverrides,
): TemplateResult {
  const valid = validateKhqrTemplate(template);
  if (!valid.ok) return valid;

  const fields = parseKhqr(valid.payload)!;
  const out: KhqrField[] = [];

  for (const field of fields) {
    // The checksum is appended after the rewrite, not carried over.
    if (field.tag === TAG_CRC) continue;

    if (field.tag === TAG_AMOUNT) {
      // Two decimals, matching how the banks themselves write it.
      out.push({ tag: TAG_AMOUNT, value: amount.toFixed(2) });
      continue;
    }
    if (field.tag === TAG_MERCHANT_NAME && merchantName && merchantName.trim()) {
      const name = merchantName.trim();
      // The spec caps this at 25 characters; a longer one would be
      // truncated by the payer's app, or rejected outright.
      if (name.length > 25) return { ok: false, reason: 'name-too-long' };
      out.push({ tag: TAG_MERCHANT_NAME, value: name });
      continue;
    }
    if (field.tag === TAG_POINT_OF_INITIATION) {
      // 11 = static (payer types the amount), 12 = dynamic. Carrying an
      // amount makes it dynamic by definition.
      out.push({ tag: TAG_POINT_OF_INITIATION, value: '12' });
      continue;
    }
    out.push(field);
  }

  const body = `${serialiseKhqr(out)}${TAG_CRC}04`;
  return { ok: true, payload: `${body}${khqrCrc(body)}` };
}

/** Pulls one top-level field out of a payload, for display and checks. */
export function readKhqrField(payload: string, tag: string): string | null {
  const fields = parseKhqr(payload);
  return fields?.find((f) => f.tag === tag)?.value ?? null;
}
