// Shared display-number formatting — kept in one place so the compact
// "1.2K" / "3.4M" style used for view counts reads the same everywhere
// (poster cards, the detail page, admin stats) instead of drifting.
export function fmtViews(n: number | null | undefined): string {
  const value = n ?? 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
