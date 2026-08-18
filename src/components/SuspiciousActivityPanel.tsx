import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('suspicious_activity')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(100);
      if (err) setError(err.message);
      setItems(data ?? []);
      setLoading(false);
    })();
  }, []);

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
            items.map((row) => (
              <div key={row.id} className="rounded-xl border border-red-500/25 bg-red-500/5 px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">
                    {row.telegram_username ? `@${row.telegram_username}` : row.telegram_user_id}
                  </p>
                  <span className="shrink-0 text-[10px] text-white/40">
                    {new Date(row.detected_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-red-300">
                  {row.episode_count} episodes within {row.window_minutes} min
                </p>
                <p className="mt-1 text-[10px] text-white/30">ID: {row.telegram_user_id}</p>
              </div>
            ))
          )}
        </div>
    </AdminPanelShell>
  );
}
