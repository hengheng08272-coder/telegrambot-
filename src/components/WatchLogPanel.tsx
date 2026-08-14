import { useEffect, useState } from 'react';
import { Loader2, Eye as EyeIcon, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';

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

// Read-only — every row is inserted by the video player the moment
// someone opens an episode (see VideoPlayerScreen.tsx). Purely a log
// viewer; nothing here writes back to the table.
export default function WatchLogPanel({ onClose }: Props) {
  const [items, setItems] = useState<WatchLogRow[]>([]);
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
      setItems(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#0F1116] p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <EyeIcon className="h-4 w-4 text-[#E3B341]" />
            <h2 className="text-sm font-bold">Watch log</h2>
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
            <p className="py-6 text-center text-xs text-white/40">No watch sessions logged yet.</p>
          ) : (
            items.map((row) => (
              <div key={row.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <p className="truncate text-sm font-semibold text-white">
                    {row.show_title} <span className="text-white/40">· {row.episode_label}</span>
                  </p>
                  <span className="shrink-0 text-[10px] text-white/40">
                    {new Date(row.started_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-white/60">
                  {row.telegram_username ? `@${row.telegram_username}` : row.telegram_user_id ?? 'Unknown'}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
