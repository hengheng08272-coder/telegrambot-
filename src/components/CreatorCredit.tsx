// Small, unobtrusive credit — sits just above the bottom nav bar so it
// never blocks navigation or content underneath.
export default function CreatorCredit() {
  return (
    <div className="pointer-events-none fixed bottom-[70px] right-3 z-30 flex select-none items-center gap-1.5 opacity-80">
      <span className="rounded-full bg-black/25 px-1.5 py-0.5 backdrop-blur-sm">
        <span className="font-mono text-[9px] font-semibold text-[#E31E24]/80">{'</>'}</span>{' '}
        <span className="text-[9px] text-white/25">Developed by Pang Sok Heng</span>
      </span>
    </div>
  );
}
