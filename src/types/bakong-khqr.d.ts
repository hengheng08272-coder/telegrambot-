// The NBC's KHQR SDK ships as plain JavaScript with no typings. Rather
// than casting it to `any` at the call site, this declares the small part
// of its surface this app actually uses (see src/lib/bakong.ts), so a
// wrong argument is still caught at compile time.
declare module 'bakong-khqr' {
  export interface KHQRIndividualOptional {
    currency?: number;
    /**
     * Number or string. A string is written through verbatim, which is
     * how an amount keeps its cents: 1 becomes `54011`, '1.00' becomes
     * `54041.00` — the latter being what ABA itself emits.
     */
    amount?: number | string;
    billNumber?: string;
    storeLabel?: string;
    terminalLabel?: string;
    mobileNumber?: string;
    purposeOfTransaction?: string;
    /** Unix epoch in milliseconds; the QR is rejected after this. */
    expirationTimestamp?: number;
    merchantCategoryCode?: string;
    accountInformation?: string;
    acquiringBank?: string;
  }

  export class IndividualInfo {
    constructor(
      bakongAccountID: string,
      merchantName: string,
      merchantCity: string,
      optional?: KHQRIndividualOptional,
    );
  }

  /**
   * A registered merchant, written to tag 30 instead of tag 29. The
   * merchant id is the part tag 29 has no room for, and the part a bank
   * checks before it will accept a dynamic QR from outside its own app.
   */
  export class MerchantInfo {
    constructor(
      bakongAccountID: string,
      merchantName: string,
      merchantCity: string,
      merchantID: string,
      acquiringBank: string,
      optional?: KHQRIndividualOptional,
    );
  }

  export interface KHQRStatus {
    code: number;
    errorCode: number | null;
    message: string | null;
  }

  export interface KHQRGenerateResponse {
    data: { qr: string; md5: string } | null;
    status: KHQRStatus;
  }

  export interface KHQRVerifyResponse {
    isValid: boolean;
  }

  export class BakongKHQR {
    generateIndividual(info: IndividualInfo): KHQRGenerateResponse;
    generateMerchant(info: MerchantInfo): KHQRGenerateResponse;
    static verify(khqr: string): KHQRVerifyResponse;
    static decode(khqr: string): { data: Record<string, unknown> | null; status: KHQRStatus };
  }

  export const khqrData: {
    currency: { khr: number; usd: number };
    merchantType: { merchant: string; individual: string };
  };
}
