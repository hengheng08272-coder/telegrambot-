const MESSAGE = 'សូមអរគុណដល់សមាជិកគ្រប់រូបដែលគាំទ្រ Nint Anime 💜  ·  ';

// A quiet, always-on marquee — now rendered in normal document flow
// (previously a `fixed` overlay guessing the header's pixel height, which
// is what caused it to visually collide with the header controls). Sitting
// in-flow means it always lands exactly where its parent puts it, with no
// height assumptions to go stale.
export default function SupporterTicker() {
  const repeated = MESSAGE.repeat(6);
  return (
    <div className="pointer-events-none relative z-10 w-full overflow-hidden bg-black/15 py-1.5 backdrop-blur-sm">
      <style>{`
        @keyframes nint-ticker-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
      <div
        className="ticker-fade flex w-max whitespace-nowrap text-[13px] font-semibold tracking-wide text-[#FFC94A]/75"
        style={{ animation: 'nint-ticker-scroll 32s linear infinite' }}
      >
        <span>{repeated}</span>
        <span>{repeated}</span>
      </div>
    </div>
  );
}
