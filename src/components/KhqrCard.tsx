interface KhqrCardProps {
  /** Name the payer will see in their banking app. */
  merchantName: string;
  /** Price in USD — printed the way ABA prints it, e.g. `2.00 USD`. */
  amount: number;
  /** Data URL of the generated QR. */
  qrDataUrl: string;
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
export default function KhqrCard({ merchantName, amount, qrDataUrl }: KhqrCardProps) {
  return (
    <div className="mx-auto mt-3.5 w-full max-w-[220px] overflow-hidden rounded-xl bg-white shadow-[0_10px_34px_rgba(0,0,0,0.55)]">
      {/* Header band. The notch on the bottom-right is the KHQR ticket's
          own shape — a clipped corner, so it needs no artwork. */}
      <div
        className="relative bg-[#E11B24] px-3 py-2"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 55%, 88% 100%, 0 100%)' }}
      >
        <p className="text-center text-[13px] font-black tracking-[0.12em] text-white">KHQR</p>
      </div>

      <div className="px-3 pb-3 pt-2.5">
        <p className="truncate text-left text-[12px] font-bold text-[#1A1A1A]">{merchantName}</p>
        <p className="text-left text-[17px] font-extrabold leading-tight text-[#1A1A1A]">
          {amount.toFixed(2)}
          <span className="ml-1 text-[11px] font-semibold text-[#6B6B6B]">USD</span>
        </p>

        <div className="my-2.5 border-t border-dashed border-[#D8D8D8]" />

        <img src={qrDataUrl} alt="KHQR" className="mx-auto block w-full" />
      </div>
    </div>
  );
}
