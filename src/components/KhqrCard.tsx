import { formatAmount, type Currency } from '@/lib/format';

interface KhqrCardProps {
  /** Name the payer will see in their banking app. */
  merchantName: string;
  /** Price, printed the way a bank prints it, e.g. `2.00 USD` / `4,000 KHR`. */
  amount: number;
  /** Which money `amount` is in. Defaults to USD. */
  currency?: Currency;
  /** Data URL of the generated QR. */
  qrDataUrl: string;
  /**
   * How much room the ticket takes.
   *
   * `full` is for a screen whose whole job is this payment — the QR is
   * the thing being scanned, by a second phone held at arm's length, so
   * it gets as much width as the sheet will give it. `compact` is for the
   * older inline spot inside a taller scrolling form.
   */
  size?: 'compact' | 'full';
}

/**
 * The familiar KHQR ticket, drawn around a QR this app generated.
 *
 * A QR the owner uploads is usually a whole ticket graphic already — red
 * KHQR band, their name, the amount — while a generated payload renders as
 * a bare black-and-white square. Same payment, but the bare version reads
 * as less trustworthy at exactly the moment somebody is handing over
 * money, which would undo the point of putting the owner's own name in the
 * payload. So generated QRs get the same chrome, drawn in CSS: no image
 * asset, and the name and amount come from the payload's own values rather
 * than from whatever a picture happened to have printed on it.
 */
export default function KhqrCard({
  merchantName,
  amount,
  currency = 'USD',
  qrDataUrl,
  size = 'compact',
}: KhqrCardProps) {
  const full = size === 'full';
  const money = formatAmount(amount, currency);

  return (
    // A real bank-issued KHQR ticket is set in a plain grown-up sans, not
    // in the app's own display face. The ticket is the moment somebody is
    // deciding whether to hand over money, so it should look like the
    // ticket their banking app prints rather than like part of our UI —
    // the merchant name and amount are exactly what they check.
    <div
      className={`mx-auto w-full overflow-hidden bg-white ${
        full
          ? 'max-w-[300px] rounded-2xl shadow-[0_18px_50px_rgba(0,0,0,0.6)]'
          : 'max-w-[220px] rounded-xl shadow-[0_10px_34px_rgba(0,0,0,0.55)]'
      }`}
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      {/* Header band. The notch on the bottom-right is the KHQR ticket's
          own shape — a clipped corner, so it needs no artwork. */}
      <div
        className={`relative bg-[#E11B24] ${full ? 'px-4 py-2.5' : 'px-3 py-2'}`}
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 55%, 88% 100%, 0 100%)' }}
      >
        <p
          className={`text-center font-black tracking-[0.12em] text-white ${
            full ? 'text-[15px]' : 'text-[13px]'
          }`}
        >
          KHQR
        </p>
      </div>

      <div className={full ? 'px-4 pb-4 pt-3' : 'px-3 pb-3 pt-2.5'}>
        <p
          className={`truncate text-left font-bold text-[#1A1A1A] ${
            full ? 'text-[15px]' : 'text-[13px]'
          }`}
        >
          {merchantName}
        </p>
        <p
          className={`text-left font-extrabold leading-tight text-[#1A1A1A] ${
            full ? 'text-[22px]' : 'text-[17px]'
          }`}
        >
          {money.value}
          <span
            className={`ml-1 font-semibold text-[#6B6B6B] ${full ? 'text-[13px]' : 'text-[11px]'}`}
          >
            {money.unit}
          </span>
        </p>

        <div className={`border-t border-dashed border-[#D8D8D8] ${full ? 'my-3' : 'my-2.5'}`} />

        <img src={qrDataUrl} alt="KHQR" className="mx-auto block w-full" />
      </div>
    </div>
  );
}
