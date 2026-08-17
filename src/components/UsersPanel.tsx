import { useEffect, useState } from 'react';
import { Loader2, Search, ShieldCheck, ShieldX, User, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

interface SubRow {
  telegram_user_id: string;
  telegram_username: string | null;
  tier: string;
  expires_at: string;
  updated_at: string;
}

// Every row here is someone who has (or had) VIP — this is the direct,
// searchable list the admin needs when a viewer messages asking "why
// isn't my VIP working" or "can you add me a few more days", instead of
// having to go digging through the Payments log for their submission.
export default function UsersPanel({ onClose }: Props) {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('subscriptions')
      .select('telegram_user_id, telegram_username, tier, expires_at, updated_at')
      .order('expires_at', { ascending: false });
    if (err) setError(err.message);
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const extend = async (row: SubRow, days: number) => {
    setBusyId(row.telegram_user_id);
    setError('');
    const base = new Date(row.expires_at) > new Date() ? new Date(row.expires_at) : new Date();
    base.setDate(base.getDate() + days);
    const { error: err } = await supabase
      .from('subscriptions')
      .update({ expires_at: base.toISOString(), updated_at: new Date().toISOString() })
      .eq('telegram_user_id', row.telegram_user_id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    load();
  };

  const revoke = async (row: SubRow) => {
    setBusyId(row.telegram_user_id);
    setError('');
    const { error: err } = await supabase
      .from('subscriptions')
      .update({ expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('telegram_user_id', row.telegram_user_id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    load();
  };

  const filtered = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      r.telegram_user_id.includes(q) ||
      (r.telegram_username ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <AdminPanelShell
      title="Users"
      subtitle="Search by Telegram ID or @username — extend or revoke VIP"
      icon={<User className="h-4 w-4" />}
      accent="#2B5CAD"
      maxWidth="max-w-[1000px]"
      onClose={onClose}
    >

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by Telegram ID or @username…"
            className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none focus:border-[#2B5CAD]/50"
          />
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-white/40">No matching subscribers.</p>
          ) : (
            filtered.map((row) => {
              const active = new Date(row.expires_at) > new Date();
              return (
                <div
                  key={row.telegram_user_id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {row.telegram_username ? '@' + row.telegram_username : row.telegram_user_id}
                    </p>
                    <p className="text-[11px] text-white/40">
                      ID {row.telegram_user_id} · {row.tier} ·{' '}
                      {active ? 'expires' : 'expired'} {new Date(row.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
                      active ? 'bg-[#2B5CAD]/15 text-[#2B5CAD]' : 'bg-white/10 text-white/40'
                    }`}
                  >
                    {active ? <ShieldCheck className="h-3 w-3" /> : <ShieldX className="h-3 w-3" />}
                    {active ? 'Active' : 'Expired'}
                  </span>
                  <button
                    onClick={() => extend(row, 7)}
                    disabled={busyId === row.telegram_user_id}
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> 7d
                  </button>
                  <button
                    onClick={() => extend(row, 30)}
                    disabled={busyId === row.telegram_user_id}
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> 30d
                  </button>
                  <button
                    onClick={() => revoke(row)}
                    disabled={busyId === row.telegram_user_id || !active}
                    className="flex items-center gap-1 rounded-full border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-30"
                  >
                    {busyId === row.telegram_user_id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Revoke'}
                  </button>
                </div>
              );
            })
          )}
        </div>
    </AdminPanelShell>
  );
}
