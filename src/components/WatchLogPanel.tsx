import { useEffect, useMemo, useState } from 'react';
import { Loader2, Eye as EyeIcon, Crown, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

interface WatchLogRow {
  id: string;
  telegram_user_id: string | null;
  telegram_username: string | null;
  show_title: string;
  episode_label: string;
  started_at: string;
}

// Real binge-watching still takes at least a handful of seconds between
// one episode starting and the next — a scripted client hitting the
// table directly (or a UI re-render loop re-firing the same log insert)
// does not. This is only a highlight, not a judgment: it's what the
// admin's own eye was doing manually in the screenshots that prompted
// this panel to grow it.
const BURST_SECONDS = 10;

// Read-only — every row is inserted by the video player the moment
// someone opens an episode (see VideoPlayerScreen.tsx). Purely a log
// viewer; nothing here writes back to the table.
export default function WatchLogPanel({ onClose }: Props) {
  const [items, setItems] = useState<WatchLogRow[]>([]);
  const [vipIds, setVipIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('watch_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(150);
      if (err) setError(err.message);
      const rows = data ?? [];
      setItems(rows);

      // A watch-log row proves someone's client opened an episode — not
      // that they're entitled to it (the insert policy is public, same
      // as spin_claims). Cross-checking against real subscriptions is
      // what actually answers "was this person paying?".
      const ids = [...new Set(rows.map((r) => r.telegram_user_id).filter((v): v is string => !!v))];
      if (ids.length) {
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('telegram_user_id, expires_at')
          .in('telegram_user_id', ids);
        const now = Date.now();
        setVipIds(
          new Set(
            (subs ?? [])
              .filter((s) => new Date(s.expires_at).getTime() > now)
              .map((s) => s.telegram_user_id),
          ),
        );
      } else {
        setVipIds(new Set());
      }
      setLoading(false);
    })();
  }, []);

  // Flags a row as part of a burst when it and the row right after it
  // (older, since the list is newest-first) belong to the same viewer
  // and land within BURST_SECONDS of each other.
  const burstIds = useMemo(() => {
    const flagged = new Set<string>();
    for (let i = 0; i < items.length - 1; i++) {
      const a = items[i];
      const b = items[i + 1];
      if (!a.telegram_user_id || a.telegram_user_id !== b.telegram_user_id) continue;
      const gapSec = (new Date(a.started_at).getTime() - new Date(b.started_at).getTime()) / 1000;
      if (gapSec <= BURST_SECONDS) {
        flagged.add(a.id);
        flagged.add(b.id);
      }
    }
    return flagged;
  }, [items]);

  return (
    <AdminPanelShell
      title="Watch log"
      subtitle="Every playback session, newest first"
      icon={<EyeIcon className="h-4 w-4" />}
      accent="#F5C563"
      maxWidth="max-w-[900px]"
      onClose={onClose}
    >

        {error && <p className="mb-2 text-xs text-red-300">{error}</p>}

        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-xs text-white/40">No watch sessions logged yet.</p>
          ) : (
            items.map((row) => {
              const isVip = !!row.telegram_user_id && vipIds.has(row.telegram_user_id);
              const isBurst = burstIds.has(row.id);
              return (
              <div
                key={row.id}
                className={`rounded-xl border px-3 py-2.5 ${
                  isBurst ? 'border-red-500/30 bg-red-500/[0.06]' : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <p className="truncate text-sm font-semibold text-white">
                    {row.show_title} <span className="text-white/40">· {row.episode_label}</span>
                  </p>
                  <span className="shrink-0 text-[11px] text-white/40">
                    {new Date(row.started_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-xs text-white/60">
                    {/* telegram_username here is already the full display
                        label written by getCurrentTelegramUser() — either
                        "@handle" or a first name/id fallback — so it is
                        printed as-is; prefixing another "@" produced
                        "@@handle" for every real username. */}
                    {row.telegram_username || row.telegram_user_id || 'Unknown'}
                  </p>
                  {row.telegram_user_id && (
                    isVip ? (
                      <span className="flex items-center gap-1 rounded-md bg-[#F5C563]/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#F5C563]">
                        <Crown className="h-2.5 w-2.5" /> VIP
                      </span>
                    ) : (
                      <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white/35">
                        មិនមែន VIP
                      </span>
                    )
                  )}
                  {isBurst && (
                    <span className="flex items-center gap-1 rounded-md bg-red-500/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-red-300">
                      <Zap className="h-2.5 w-2.5" /> Rapid — {BURST_SECONDS}s
                    </span>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>
    </AdminPanelShell>
  );
}
