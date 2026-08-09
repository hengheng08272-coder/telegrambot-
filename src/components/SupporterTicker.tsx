const MESSAGE = 'សូមអរគុណដល់សមាជិកគ្រប់រូបដែលគាំទ្រ Nint Anime 💜  ·  ';

// A quiet, always-on marquee — not from the database, not dismissible,
// just a small thank-you that keeps drifting by under the header without
// asking for attention.
export default function SupporterTicker() {
  const repeated = MESSAGE.repeat(6);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[64px] z-30 overflow-hidden bg-black/15 py-1.5 backdrop-blur-sm sm:top-[72px]">
      <style>{`
        @keyframes nint-ticker-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
      <div
        className="ticker-fade flex w-max whitespace-nowrap text-[11px] font-medium tracking-wider text-white/35"
        style={{ animation: 'nint-ticker-scroll 32s linear infinite' }}
      >
        <span>{repeated}</span>
        <span>{repeated}</span>
      </div>
    </div>
  );
}
