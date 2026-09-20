/**
 * The row of bank marks under "works with every KHQR bank app".
 *
 * These are acceptance marks, the same thing a shop counter puts on its
 * standee: the owner supplied each file, and they are shown to answer
 * the one question a payer has when there is no bank to choose — "will
 * my own app read this?". They are decorative in the accessibility
 * sense, because the line of text beside them already says it; that is
 * why every mark carries an empty alt.
 *
 * Nothing here is drawn in code. Each mark is the owner's own image
 * file, served from /assets/banks, so replacing or adding one is a file
 * swap rather than an edit to this component.
 */
const MARKS = ['bank-1', 'bank-2', 'bank-3', 'bank-4', 'bank-5'] as const;

interface BankStripProps {
  /** Pixel height of each mark. They are square, so this is the size. */
  size?: number;
}

export default function BankStrip({ size = 22 }: BankStripProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {MARKS.map((name) => (
        <img
          key={name}
          src={`/assets/banks/${name}.jpg`}
          alt=""
          loading="lazy"
          className="rounded-[5px] object-contain ring-1 ring-white/10"
          style={{ width: size, height: size }}
        />
      ))}
    </div>
  );
}
