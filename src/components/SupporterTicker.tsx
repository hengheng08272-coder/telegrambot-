const SUPPORT_MESSAGE = 'សូមអរគុណដល់សមាជិកគ្រប់រូបដែលគាំទ្រ Nint Anime 💜  ·  ';

interface SupporterTickerProps {
  /** Title of the current #1 trending show, when known — rendered as a
   *  live "trending now" line ahead of the static thank-you message so the
   *  ticker always leads with something that actually changes, instead of
   *  only ever showing the same fixed text. Omitted (ticker falls back to
   *  the thank-you message alone) while shows are still loading. */
  trendingTitle?: string;
  trendingPrefix?: string;
}

// A quiet, always-on marquee — now rendered in normal document flow
// (previously a `fixed` overlay guessing the header's pixel height, which
// is what caused it to visually collide with the header controls). Sitting
// in-flow means it always lands exactly where its parent puts it, with no
// height assumptions to go stale.
export default function SupporterTicker({ trendingTitle, trendingPrefix }: SupporterTickerProps) {
  const message = trendingTitle
    ? `🔥 ${trendingPrefix ?? 'Trending now'}: ${trendingTitle}  ·  ${SUPPORT_MESSAGE}`
    : SUPPORT_MESSAGE;
  const repeated = message.repeat(4);
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
