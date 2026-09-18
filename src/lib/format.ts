// Shared display-number formatting — kept in one place so the compact
// "1.2K" / "3.4M" style used for view counts reads the same everywhere
// (poster cards, the detail page, admin stats) instead of drifting.
export function fmtViews(n: number | null | undefined): string {
  const value = n ?? 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/** The two currencies a KHQR can be drawn in. Nothing else is offered:
 *  Bakong itself only settles these two. */
export type Currency = 'USD' | 'KHR';

export function isCurrency(value: string | null | undefined): value is Currency {
  return value === 'USD' || value === 'KHR';
}

/**
 * Money as a price tag — the short form that goes on a badge or a button.
 *
 * Riel is written whole and grouped (`៛4,000`); a riel price with cents
 * would be nonsense, and four unbroken digits is the one thing that makes
 * a riel figure hard to read at badge size. Dollars drop a trailing
 * `.00`, because `$1` is what a price tag says and `$1.00` is what a
 * receipt says — this is the tag.
 */
export function formatPrice(amount: number, currency: Currency = 'USD'): string {
  if (currency === 'KHR') return `៛${Math.round(amount).toLocaleString('en-US')}`;
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/**
 * Money the way a bank prints it, for the KHQR ticket and the total due.
 *
 * Here the cents are kept even when they are zero: this is the figure the
 * payer checks against their banking app, and their banking app writes
 * `2.00 USD`. Matching it exactly removes a moment of doubt at the only
 * point in the app where somebody is handing over money.
 */
export function formatAmount(amount: number, currency: Currency = 'USD'): {
  value: string;
  unit: string;
} {
  if (currency === 'KHR') {
    return { value: Math.round(amount).toLocaleString('en-US'), unit: 'KHR' };
  }
  return { value: amount.toFixed(2), unit: 'USD' };
}
