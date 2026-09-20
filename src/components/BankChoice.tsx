import { Check } from 'lucide-react';

export type BankKey = 'primary' | 'alt';

interface BankChoiceProps {
  /** Name the owner gave the first pasted template, e.g. "ABA". */
  primaryLabel: string;
  /** Name the owner gave the second one, e.g. "ACLEDA". */
  altLabel: string;
  value: BankKey;
  onChange: (key: BankKey) => void;
  /** Short line above the pair, e.g. "Pay from". */
  heading?: string;
}

/**
 * Which bank's KHQR to show.
 *
 * This exists for one reason and it is not a preference: the two banks
 * will not accept the same payload. ABA refuses a QR whose payee name has
 * been rewritten, ACLEDA accepts it — so the owner pastes two templates
 * and the payer picks the one their own app will actually read.
 *
 * Drawn as two real choices, not as a settings toggle. The old version
 * was a pair of unlabelled grey rectangles sitting under the amount,
 * which read as "advanced options" — something to be ignored — at the
 * exact moment the viewer needed to make a decision. Now it sits above
 * the code, each side names its bank, and the selected one is marked the
 * way a chosen payment method is marked everywhere else: a tick.
 */
export default function BankChoice({
  primaryLabel,
  altLabel,
  value,
  onChange,
  heading,
}: BankChoiceProps) {
  const options: Array<[BankKey, string]> = [
    ['primary', primaryLabel],
    ['alt', altLabel],
  ];

  return (
    <div>
      {heading && (
        <p className="co-label mb-2 block text-center">
          {heading}
        </p>
      )}
      <div className="mx-auto grid max-w-[280px] grid-cols-2 gap-2">
        {options.map(([key, label]) => {
          const on = value === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(key)}
              className={`flex min-h-[46px] items-center justify-center gap-1.5 rounded-[var(--co-r-btn)] border px-2.5 py-2.5 transition active:scale-[0.98] ${
                on
                  ? 'border-[color:var(--co-brand-ring)] bg-[color:var(--co-brand-soft)]'
                  : 'border-[color:var(--co-line)] bg-white/[0.03]'
              }`}
            >
              {/* The tick only appears on the chosen side, so the pair
                  never looks like two things that are both switched on. */}
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition ${
                  on ? 'bg-[color:var(--co-brand)]' : 'bg-white/10'
                }`}
              >
                {on && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />}
              </span>
              <span
                className={`min-w-0 truncate text-[13px] font-bold ${
                  on ? 'text-[color:var(--co-text)]' : 'text-[color:var(--co-text-dim)]'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
