import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, Crown, ShieldBan, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { addBlockedTelegramUser, errorMessage } from '@/lib/api';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

interface SuspiciousRow {
  id: string;
  telegram_user_id: string;
  telegram_username: string | null;
  episode_count: number;
  window_minutes: number;
  detected_at: string;
}

// Read-only — rows are written by the `flag_watch_burst` Postgres trigger
// (see database/suspicious-activity-addition.sql), not from the client.
// The same event also DMs the admin instantly via the
// notify-suspicious-activity Edge Function; this panel is just the
// in-app history of everything that's ever been flagged.
export default function SuspiciousActivityPanel({ onClose }: Props) {
  const [items, setItems] = useState<SuspiciousRow[]>([]);
  const [vipIds, setVipIds] = useState<Set<string>>(new Set());
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [blockingId, setBlockingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('suspicious_activity')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(100);
    if (err) setError(err.message);
    const rows = data ?? [];
    setItems(rows);

    const ids = [...new Set(rows.map((r) => r.telegram_user_id))];
    if (ids.length) {
      const [subsRes, blockedRes] = await Promise.all([
        supabase.from('subscriptions').select('telegram_user_id, expires_at').in('telegram_user_id', ids),
        supabase.from('blocked_telegram_users').select('telegram_user_id').in('telegram_user_id', ids),
      ]);
      const now = Date.now();
      setVipIds(
        new Set(
          (subsRes.data ?? [])
            .filter((s) => new Date(s.expires_at).getTime() > now)
            .map((s) => s.telegram_user_id),
        ),
      );
      setBlockedIds(
        new Set((blockedRes.data ?? []).map((b) => b.telegram_user_id).filter((v): v is string => !!v)),
      );
    } else {
      setVipIds(new Set());
      setBlockedIds(new Set());
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // A manual, one-click extension of the existing block list (Admin Panel
  // -> Blocked Users) — not an automatic ban. The burst trigger flags a
  // *pattern*, not a verdict: watch_log is publicly insertable by design
  // (same shape as spin_claims), so a flagged row is not proof by itself
  // that this exact person did the scripting. The admin still decides;
  // this just removes the copy-paste of the Telegram ID into the other
  // panel. Only the ID is sent — never the logged "username" field, which
  // stores the app's own "@handle" display label rather than the bare
  // handle blocked_telegram_users expects, so forwarding it as-is would
  // silently fail to match on unblock/lookup.
  const handleBlock = async (row: SuspiciousRow) => {
    if (!confirm(`ទប់ស្កាត់ (Block) អ្នកនេះ? (ID: ${row.telegram_user_id})`)) return;
    setBlockingId(row.id);
    setError('');
    try {
      await addBlockedTelegramUser({
        telegram_user_id: row.telegram_user_id,
        reason: `Auto-flagged: ${row.episode_count} episodes within ${row.window_minutes} min`,
      });
      setBlockedIds((prev) => new Set(prev).add(row.telegram_user_id));
    } catch (e: unknown) {
      setError(errorMessage(e, 'Failed to block user'));
    } finally {
      setBlockingId(null);
    }
  };

  return (
    <AdminPanelShell
      title="Suspicious activity"
      subtitle="Viewers who burned through episodes fast enough to look like ripping"
      icon={<AlertTriangle className="h-4 w-4" />}
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
            <p className="py-6 text-center text-xs text-white/40">
              Nothing flagged yet — this list stays empty until someone
              trips the burst threshold.
            </p>
          ) : (
            items.map((row) => {
              const isVip = vipIds.has(row.telegram_user_id);
              const isBlocked = blockedIds.has(row.telegram_user_id);
              return (
              <div key={row.id} className="rounded-xl border border-red-500/25 bg-red-500/5 px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <p className="text-sm font-semibold text-white">
                      {/* Already the full "@handle" (or name/id fallback)
                          label the client logs — see WatchLogPanel's note. */}
                      {row.telegram_username || row.telegram_user_id}
                    </p>
                    {isVip ? (
                      <span className="flex items-center gap-1 rounded-md bg-[#F5C563]/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#F5C563]">
                        <Crown className="h-2.5 w-2.5" /> VIP
                      </span>
                    ) : (
                      <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white/35">
                        មិនមែន VIP
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] text-white/40">
                    {new Date(row.detected_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-red-300">
                  {row.episode_count} episodes within {row.window_minutes} min
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-white/30">ID: {row.telegram_user_id}</p>
                  {isBlocked ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-[#2FD98C]">
                      <Check className="h-3 w-3" /> Blocked
                    </span>
                  ) : (
                    <button
                      onClick={() => handleBlock(row)}
                      disabled={blockingId === row.id}
                      className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {blockingId === row.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ShieldBan className="h-3 w-3" />
                      )}
                      ទប់ស្កាត់
                    </button>
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
