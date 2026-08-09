// Small, unobtrusive credit — sits just above the bottom nav bar so it
// never blocks navigation or content underneath.
export default function CreatorCredit() {
  return (
    <div className="pointer-events-none fixed bottom-[68px] right-3 z-30 flex select-none items-center gap-1.5">
      <span className="rounded-full bg-black/30 px-2 py-0.5 backdrop-blur-sm">
        <span className="font-mono text-[10px] font-semibold text-[#E31E24]">{'</>'}</span>{' '}
        <span className="text-[10px] text-white/35">Developed by Pang Sok Heng</span>
      </span>
    </div>
  );
}
