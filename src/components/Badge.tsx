import type { ReactNode } from 'react';

/**
 * The app's one badge.
 *
 * Every cover in this app used to carry its own invention: a black pill
 * for the rank, a gold gradient for VIP, a green tint for free, a red
 * circle for Coming Soon, a blue chip for the episode number, plus HOT
 * and SOON tags on the rails — six shapes, six type sizes, six colours,
 * all within a few hundred pixels of each other. On top of poster art
 * that is already loud, that reads as noise rather than information.
 *
 * One shape, one size, five meanings:
 *
 *   vip     gold      — this needs a membership
 *   free    green     — this costs nothing
 *   price   blue      — this can be bought, and here is what it costs
 *   mark    red       — a fact about the title (trending, ongoing, soon)
 *   info    neutral   — everything else (episode counts, rank, type)
 *
 * Colour carries the meaning, so nothing else has to vary: same radius,
 * same padding, same weight everywhere.
 */
export type BadgeTone = 'vip' | 'free' | 'price' | 'mark' | 'info';

interface Props {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Sits on artwork rather than on the app's own surface — adds the
   *  blur and slightly heavier ground a poster needs behind it. */
  onArt?: boolean;
}

const TONES: Record<BadgeTone, string> = {
  vip: 'text-[#211A0E] bg-gradient-to-br from-[#FFE7B0] via-[#F5C563] to-[#B98430]',
  free: 'text-[#2FD98C] bg-[#2FD98C]/16 ring-1 ring-inset ring-[#2FD98C]/35',
  price: 'text-white bg-gradient-to-br from-[#2050D8] to-[#0E2560]',
  mark: 'text-[#FF6B60] bg-[#E6231F]/16 ring-1 ring-inset ring-[#E6231F]/40',
  info: 'text-white/85 bg-white/10 ring-1 ring-inset ring-white/12',
};

export default function Badge({ tone = 'info', icon, children, className = '', onArt }: Props) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-[3px] text-[9.5px] font-bold leading-none ${
        TONES[tone]
      } ${onArt ? 'backdrop-blur-sm shadow-[0_2px_8px_rgba(2,4,10,0.5)]' : ''} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}
