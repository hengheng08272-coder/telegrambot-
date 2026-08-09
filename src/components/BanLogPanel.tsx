import { useEffect, useState } from 'react';
import { Loader2, ShieldBan, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';

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
  kicked_auto: 'border-[#FFC94A]/25 bg-[#FFC94A]/5 text-[#FFC94A]',
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
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#170D0C] p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <ShieldBan className="h-4 w-4 text-[#FFC94A]" />
            <h2 className="text-sm font-bold">Ban log (group)</h2>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p className="mb-2 text-xs text-red-300">{error}</p>}

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
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
      </div>
    </div>
  );
}
