// The NBC's KHQR SDK ships as plain JavaScript with no typings. Rather
// than casting it to `any` at the call site, this declares the small part
// of its surface this app actually uses (see src/lib/bakong.ts), so a
// wrong argument is still caught at compile time.
declare module 'bakong-khqr' {
  export interface KHQRIndividualOptional {
    currency?: number;
    amount?: number;
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

  export class MerchantInfo extends IndividualInfo {}

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
