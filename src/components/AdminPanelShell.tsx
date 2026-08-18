import { useEffect, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';

interface Props {
  /** What this panel is called, in the header. */
  title: string;
  /** One line under the title saying what the panel is for. */
  subtitle?: string;
  /** Small icon shown in the tinted chip left of the title. */
  icon?: ReactNode;
  /** Hex accent for the icon chip — usually the same colour as the
   *  section's pill in the admin nav, so a panel is recognisable
   *  before its title is even read. */
  accent?: string;
  /** Buttons pinned to the right of the header row. */
  actions?: ReactNode;
  /** Optional second header row: search, filters, section tabs. Stays
   *  stuck to the top while the body scrolls. */
  toolbar?: ReactNode;
  /** Current error message, rendered in a standard banner. */
  error?: string;
  onDismissError?: () => void;
  onClose: () => void;
  /** Tailwind max-width for the content column. Lists want a narrow
   *  measure; editors with side-by-side fields want a wide one. */
  maxWidth?: string;
  children: ReactNode;
}

// =====================================================================
// Every admin panel used to be its own centred modal box capped at
// max-h-[85vh] and max-w-md. On a desktop that meant a small window
// floating in the middle of a large empty screen, with the real content
// trapped in an inner scrollbox — so editing a plan or working through
// a payment queue meant scrolling inside a scroll inside a page.
//
// This shell replaces all of them with one full-screen layout: a single
// sticky header, a single scroll container, and a shared content width.
// Panels now only supply their own body, which is why they all look and
// behave the same no matter which one is open.
// =====================================================================
export default function AdminPanelShell({
  title,
  subtitle,
  icon,
  accent = '#F5C563',
  actions,
  toolbar,
  error,
  onDismissError,
  onClose,
  maxWidth = 'max-w-[1100px]',
  children,
}: Props) {
  // Escape closes, and the page behind must not scroll while a
  // full-screen panel is up — otherwise closing it lands the admin
  // somewhere else in the show list than where they left off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-app text-white">
      <header className="sticky top-0 z-10 shrink-0 border-b border-white/10 bar-blur">
        <div className={`mx-auto flex ${maxWidth} items-center gap-3 px-4 py-3.5 sm:px-8`}>
          <button
            onClick={onClose}
            className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </button>

          {icon && (
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${accent}1A`, color: accent }}
            >
              {icon}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold text-white sm:text-base">{title}</h2>
            {subtitle && <p className="truncate text-[11px] text-white/40">{subtitle}</p>}
          </div>

          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>

        {toolbar && (
          <div className={`mx-auto ${maxWidth} px-4 pb-3 sm:px-8`}>{toolbar}</div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto ${maxWidth} px-4 py-5 sm:px-8 sm:py-6`}>
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#FF4D5E]/30 bg-[#FF4D5E]/10 px-3.5 py-3 text-xs text-[#FFB3BD]">
              <span className="flex-1 leading-relaxed">{error}</span>
              {onDismissError && (
                <button onClick={onDismissError} className="shrink-0 text-[#FFB3BD]/70 hover:text-[#FFB3BD]">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * The section tabs used inside a panel's `toolbar`. Splitting a dense
 * panel into sections is what stops every card carrying eight fields at
 * once — the admin picks the job (prices, QR, auto-confirm) and only
 * that job's fields are on screen.
 */
export function PanelTabs<T extends string>({
  tabs,
  active,
  onChange,
  accent = '#F5C563',
}: {
  tabs: { key: T; label: string; icon?: ReactNode; badge?: number }[];
  active: T;
  onChange: (key: T) => void;
  accent?: string;
}) {
  return (
    <nav className="no-scrollbar flex items-center gap-2 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
              isActive ? '' : 'border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/[0.08] hover:text-white/80'
            }`}
            style={
              isActive
                ? { borderColor: `${accent}55`, backgroundColor: `${accent}1F`, color: accent }
                : undefined
            }
          >
            {tab.icon}
            {tab.label}
            {typeof tab.badge === 'number' && tab.badge > 0 && (
              <span className="rounded-full bg-white/15 px-1.5 text-[10px] font-extrabold text-white/80">
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
