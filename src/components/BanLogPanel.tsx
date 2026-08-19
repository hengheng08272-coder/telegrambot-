import { useEffect, useState } from 'react';
import { Loader2, ShieldBan } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

interface BanLogRow {
  id: string;
  telegram_user_id: string;
  telegram_username: string | null;
  action: 'banned' | 'unbanned' | 'kicked_auto';
  reason: string | null;
  source: string;
  performed_by: string | null;
  created_at: string;
}

const ACTION_LABEL: Record<BanLogRow['action'], string> = {
  banned: 'Banned',
  unbanned: 'Unbanned',
  kicked_auto: 'Kicked',
};

const ACTION_COLOR: Record<BanLogRow['action'], string> = {
  banned: 'border-red-500/25 bg-red-500/5 text-red-300',
  unbanned: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300',
  kicked_auto: 'border-[#F5C563]/25 bg-[#F5C563]/5 text-[#F5C563]',
};

// Read-only — every row here is written server-side by the
// `telegram-admin-bot` Edge Function via the service role key (see
// supabase/functions/telegram-admin-bot). Nothing in this panel writes
// back to the table; it's purely a log viewer for the admin.
export default function BanLogPanel({ onClose }: Props) {
  const [items, setItems] = useState<BanLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from('ban_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (err) setError(err.message);
      setItems(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <AdminPanelShell
      title="Ban log"
      subtitle="Ban and kick events recorded from the Telegram group"
      icon={<ShieldBan className="h-4 w-4" />}
      accent="#FF4D5E"
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
              No ban/kick events logged yet.
            </p>
          ) : (
            items.map((row) => (
              <div
                key={row.id}
                className={`rounded-xl border px-3 py-2.5 ${ACTION_COLOR[row.action]}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide">
                    {ACTION_LABEL[row.action]}
                  </span>
                  <span className="text-[10px] text-white/40">
                    {new Date(row.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-white">
                  {row.telegram_username ? `@${row.telegram_username}` : row.telegram_user_id}
                  <span className="ml-1 text-xs text-white/40">({row.telegram_user_id})</span>
                </p>
                {row.reason && <p className="mt-1 text-xs text-white/60">Reason: {row.reason}</p>}
                <p className="mt-1 text-[10px] text-white/30">
                  {row.source}
                  {row.performed_by ? ` · by ${row.performed_by}` : ''}
                </p>
              </div>
            ))
          )}
        </div>
    </AdminPanelShell>
  );
}
