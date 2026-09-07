// What colour a home-screen row is allowed to be.
//
// The home screen had drifted into eleven rows whose headers each picked
// a colour by hand: green ticks, red clapperboards, blue layers, and six
// rows on `text-white/45` because nobody decided. Read top to bottom that
// is not a palette, it is a list of one-off choices — and the two that
// matter (green means free, gold means VIP) got lost among the ones that
// meant nothing.
//
// So a row does not choose a colour here. It chooses a ROLE, and the role
// already has a colour — the same five roles DESIGN_SYSTEM.md defines for
// the whole app, no sixth hue invented for decoration:
//
//   free    green   you can watch this now, no money
//   vip     gold    membership territory
//   mark    red     a fact about the shows, never a thing to tap
//   guide   blue    structure — how the catalogue is organised
//   plain   slate   a genre. The artwork is the colour.
//
// Two rows may share a role; that is the point. "Free to Watch" and a
// completed series are both green because both answer "can I watch all of
// this tonight". "New Release", "Popular" and "Coming Soon" are all red
// because all three are facts, not offers.
//
// The accent reaches the artwork too: RailRow publishes it as the
// `--row-accent` custom property, and every card in the row lights up in
// its row's colour on hover instead of the one hard-coded blue.

export type RowRole = 'free' | 'vip' | 'mark' | 'guide' | 'plain';

export const ROW_ACCENT: Record<RowRole, string> = {
  free: '#2FD98C',
  vip: '#F5C563',
  mark: '#E6231F',
  guide: '#4E86FF',
  plain: '#8FA3CC',
};

/**
 * `tint('#2FD98C', 0.15)` -> `rgba(47,217,140,0.15)`.
 *
 * Row accents are declared as plain hex so they can be alpha-composited
 * at several strengths — a full-strength icon, a 30% rule, a 12% wash —
 * without keeping four spellings of one colour around.
 */
export function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
