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
   * Both sizes are deliberately modest. A QR only has to be big enough
   * for a second phone's camera to lock on from a comfortable distance,
   * and roughly 200px of screen is already well past that — beyond it
   * the code stops being a code and starts being wallpaper, pushing the
   * amount, the bank choice and the pay button off the screen. `full` is
   * for a dialog whose whole job is this one payment; `compact` is for
   * the inline spot inside a taller scrolling form.
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
          ? 'max-w-[244px] rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.55)]'
          : 'max-w-[196px] rounded-xl shadow-[0_10px_28px_rgba(0,0,0,0.5)]'
      }`}
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      {/* Header band. The notch on the bottom-right is the KHQR ticket's
          own shape — a clipped corner, so it needs no artwork. */}
      <div
        className={`relative bg-[#E11B24] ${full ? 'px-3.5 py-2' : 'px-3 py-1.5'}`}
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 55%, 88% 100%, 0 100%)' }}
      >
        <p
          className={`text-center font-black tracking-[0.14em] text-white ${
            full ? 'text-[13px]' : 'text-[11.5px]'
          }`}
        >
          KHQR
        </p>
      </div>

      <div className={full ? 'px-3.5 pb-3.5 pt-2.5' : 'px-3 pb-3 pt-2'}>
        {/* Name and amount on one baseline: the two things the payer
            checks against their banking app, read together instead of
            stacked as two separate headlines. */}
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={`min-w-0 flex-1 truncate text-left font-semibold text-[#1A1A1A] ${
              full ? 'text-[12.5px]' : 'text-[11px]'
            }`}
          >
            {merchantName}
          </p>
          <p
            className={`shrink-0 whitespace-nowrap text-right font-extrabold tabular-nums leading-none text-[#111]  ${
              full ? 'text-[19px]' : 'text-[16px]'
            }`}
          >
            {money.value}
            <span
              className={`ml-1 font-semibold text-[#8A8A8A] ${
                full ? 'text-[11px]' : 'text-[9.5px]'
              }`}
            >
              {money.unit}
            </span>
          </p>
        </div>

        <div className={`border-t border-dashed border-[#DCDCDC] ${full ? 'my-2.5' : 'my-2'}`} />

        <img src={qrDataUrl} alt="KHQR" className="mx-auto block w-full" />
      </div>
    </div>
  );
}
