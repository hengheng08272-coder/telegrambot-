// Small, unobtrusive credit — now an in-flow footer line instead of a
// floating fixed badge, so it can never sit on top of poster art or the
// bottom nav no matter how the page scrolls.
export default function CreatorCredit() {
  return (
    <span className="inline-flex select-none items-center gap-1.5 opacity-70">
      <span className="font-mono text-[9.5px] font-semibold text-[#2050D8]/80">{'</>'}</span>
      <span className="text-[9.5px] text-white/25">Developed by Pang Sok Heng</span>
    </span>
  );
}
