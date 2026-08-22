// =====================================================================
// KHQR payload surgery — server side.
//
// A port of src/lib/khqrTemplate.ts and src/lib/md5.ts into the edge
// runtime. Edge functions are bundled on their own and cannot reach the
// Vite `@/` alias, so the logic lives twice rather than being imported
// across that boundary. Keep the two in step: a divergence here shows up
// as a QR the admin panel previewed one way and the member received
// another, which is exactly the class of bug khqr-issue exists to end.
//
// Why rewrite a bank's payload instead of building one: ABA refuses a
// KHQR it did not issue. Its own QRs carry a proprietary tag 40
// (`abaP2P`) holding a per-account reference nothing outside ABA can
// know, so a spec-perfect payload built from scratch renders correctly,
// names the right payee and amount, and is then rejected at the moment
// of payment with "Invalid Qr Merchant Data". Reusing one real QR
// sidesteps the question entirely: only the fields named below change,
// everything the bank cared about travels through byte for byte.
// =====================================================================

export interface KhqrField {
  tag: string;
  value: string;
}

/**
 * Splits an EMVCo payload into its top-level tag/value pairs.
 *
 * Returns null on anything that does not parse cleanly rather than
 * half-reading it — a malformed template must be rejected at setup time,
 * not turned into a subtly wrong QR at payment time.
 */
export function parseKhqr(payload: string): KhqrField[] | null {
  const fields: KhqrField[] = [];
  let i = 0;
  while (i < payload.length) {
    // Every field is 2-char tag + 2-digit length + value.
    if (i + 4 > payload.length) return null;
    const tag = payload.slice(i, i + 2);
    const lengthText = payload.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(lengthText)) return null;
    const len = Number(lengthText);
    if (i + 4 + len > payload.length) return null;
    fields.push({ tag, value: payload.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return fields.length ? fields : null;
}

export function serialiseKhqr(fields: KhqrField[]): string {
  return fields
    .map(({ tag, value }) => `${tag}${String(value.length).padStart(2, "0")}${value}`)
    .join("");
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
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** True when a payload's trailing checksum matches its own contents. */
export function hasValidKhqrCrc(payload: string): boolean {
  // ...6304XXXX — the last tag is always the 4-char CRC of everything
  // before it, the "6304" header included.
  if (payload.length < 8 || payload.slice(-8, -4) !== "6304") return false;
  return khqrCrc(payload.slice(0, -4)) === payload.slice(-4).toUpperCase();
}

const TAG_AMOUNT = "54";
const TAG_MERCHANT_NAME = "59";
const TAG_ADDITIONAL_DATA = "62";
const TAG_CRC = "63";
const TAG_POINT_OF_INITIATION = "01";
/** Bill number, inside tag 62's own TLV. */
const SUBTAG_BILL_NUMBER = "01";

/** The spec's cap on the merchant name, and on a bill number. */
const MAX_MERCHANT_NAME = 25;
const MAX_BILL_NUMBER = 25;

export type TemplateFailure =
  | "unparseable"
  | "bad-checksum"
  | "no-amount-field"
  | "name-too-long"
  | "name-not-ascii";

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
  if (!fields) return { ok: false, reason: "unparseable" };
  if (!hasValidKhqrCrc(trimmed)) return { ok: false, reason: "bad-checksum" };
  // A template without an amount field is a static QR — the payer types
  // the amount themselves, which is exactly what this app exists to stop.
  if (!fields.some((f) => f.tag === TAG_AMOUNT)) return { ok: false, reason: "no-amount-field" };
  return { ok: true, payload: trimmed };
}

/**
 * Whether a merchant name can be written into tag 59 at all.
 *
 * Checked before the payload is built rather than left to the bank,
 * because the bank's answer arrives as a failed payment in front of a
 * member. Non-ASCII is refused outright: tag 59 has no character-set
 * declaration, so a Khmer or emoji name is at best rendered as boxes in
 * the payer's app and at worst rejected, and neither is something to
 * discover during a real payment.
 */
export function checkMerchantName(name: string): TemplateFailure | null {
  const trimmed = name.trim();
  if (trimmed.length > MAX_MERCHANT_NAME) return "name-too-long";
  // Printable ASCII only, space included.
  if (!/^[\x20-\x7E]+$/.test(trimmed)) return "name-not-ascii";
  return null;
}

export interface TemplateOverrides {
  /** Price for this payment, replacing whatever the template carried. */
  amount: number;
  /**
   * Name to show the payer. Left alone when omitted — the bank's own
   * name for the account is the safest default, and the only one proven
   * to be accepted until a payment with a replaced name has gone
   * through.
   *
   * TESTED AND REJECTED ON ABA. A personal ABA account, a plain
   * ten-character Latin name, and ABA refuses the QR at scan time with
   * MAPP-QR-NAME-INV (QR NAME INVALID). The same template with this left
   * blank scans and pays, so ABA is checking tag 59 against the name
   * registered to the account rather than objecting to the characters.
   * Leave it unset for an ABA account. It stays here because the check is
   * the bank's, not the spec's, and another bank may well allow it.
   */
  merchantName?: string | null;
  /**
   * Ticket reference, written into tag 62's bill-number sub-tag.
   *
   * This is what makes one ticket's payload differ from another's. Two
   * tickets for the same tier otherwise produce byte-identical payloads,
   * hence one md5, and Bakong's check_transaction_by_md5 answers about
   * an md5 — so the second ticket asks about the first ticket's payment
   * and the replay guard (database/bakong-md5-addition.sql) refuses it.
   * Auto-confirm then fails silently for every repeat purchase.
   *
   * Off by default all the same: adding a field is a change to a payload
   * ABA accepted as it was, and only a real payment can prove ABA still
   * accepts it.
   */
  billNumber?: string | null;
}

/** Writes `value` into tag 62's sub-tag, preserving any others present. */
function withBillNumber(existing: string | undefined, value: string): string {
  const subFields = existing ? (parseKhqr(existing) ?? []) : [];
  const kept = subFields.filter((f) => f.tag !== SUBTAG_BILL_NUMBER);
  return serialiseKhqr([{ tag: SUBTAG_BILL_NUMBER, value }, ...kept]);
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
  { amount, merchantName, billNumber }: TemplateOverrides,
): TemplateResult {
  const valid = validateKhqrTemplate(template);
  if (!valid.ok) return valid;

  const name = merchantName?.trim() ?? "";
  if (name) {
    const nameProblem = checkMerchantName(name);
    if (nameProblem) return { ok: false, reason: nameProblem };
  }
  const bill = (billNumber ?? "").trim().slice(0, MAX_BILL_NUMBER);

  const fields = parseKhqr(valid.payload)!;
  const out: KhqrField[] = [];
  let billWritten = false;

  for (const field of fields) {
    // The checksum is appended after the rewrite, not carried over.
    if (field.tag === TAG_CRC) continue;

    // Tags run in ascending order, so 62 belongs before the first tag
    // above it. ABA's own payloads put a proprietary tag 99 after the
    // city, which would otherwise leave 62 out of order at the end.
    if (bill && !billWritten && Number(field.tag) > Number(TAG_ADDITIONAL_DATA)) {
      out.push({ tag: TAG_ADDITIONAL_DATA, value: withBillNumber(undefined, bill) });
      billWritten = true;
    }

    if (field.tag === TAG_AMOUNT) {
      // Two decimals, matching how the banks themselves write it.
      out.push({ tag: TAG_AMOUNT, value: amount.toFixed(2) });
      continue;
    }
    if (field.tag === TAG_MERCHANT_NAME && name) {
      out.push({ tag: TAG_MERCHANT_NAME, value: name });
      continue;
    }
    if (field.tag === TAG_ADDITIONAL_DATA && bill) {
      out.push({ tag: TAG_ADDITIONAL_DATA, value: withBillNumber(field.value, bill) });
      billWritten = true;
      continue;
    }
    if (field.tag === TAG_POINT_OF_INITIATION) {
      // 11 = static (payer types the amount), 12 = dynamic. Carrying an
      // amount makes it dynamic by definition.
      out.push({ tag: TAG_POINT_OF_INITIATION, value: "12" });
      continue;
    }
    out.push(field);
  }

  // A template whose every tag sorts below 62 — nothing to insert before.
  if (bill && !billWritten) {
    out.push({ tag: TAG_ADDITIONAL_DATA, value: withBillNumber(undefined, bill) });
  }

  const body = `${serialiseKhqr(out)}${TAG_CRC}04`;
  return { ok: true, payload: `${body}${khqrCrc(body)}` };
}

/** Pulls one top-level field out of a payload, for display and checks. */
export function readKhqrField(payload: string, tag: string): string | null {
  const fields = parseKhqr(payload);
  return fields?.find((f) => f.tag === tag)?.value ?? null;
}
