import { useEffect, useState } from 'react';
import { Loader2, Search, ShieldCheck, ShieldX, User, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import AdminPanelShell, { PanelTabs } from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

// "Expiring" is the only one of these that is actionable: those viewers
// are still paying customers today and will quietly disappear within the
// week unless someone reaches out. Everything else is just a count.
type Filter = 'all' | 'active' | 'expiring' | 'expired';

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
  const [filter, setFilter] = useState<Filter>('all');

  const DAY = 86_400_000;
  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);

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

  const counts = {
    all: rows.length,
    active: rows.filter((r) => daysLeft(r.expires_at) > 0).length,
    expiring: rows.filter((r) => {
      const d = daysLeft(r.expires_at);
      return d > 0 && d <= 7;
    }).length,
    expired: rows.filter((r) => daysLeft(r.expires_at) <= 0).length,
  };

  // A rough headline number, not accounting: it multiplies each row's
  // tier by that tier's CURRENT price, so historic prices are restated
  // at today's rate. Good enough to see the shape of the base; the
  // Payments panel remains the source of truth for money.
  const activeByTier = rows
    .filter((r) => daysLeft(r.expires_at) > 0)
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.tier] = (acc[r.tier] ?? 0) + 1;
      return acc;
    }, {});

  const filtered = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      r.telegram_user_id.includes(q) ||
      (r.telegram_username ?? '').toLowerCase().includes(q);
    if (!matchesQuery) return false;
    const d = daysLeft(r.expires_at);
    if (filter === 'active') return d > 0;
    if (filter === 'expiring') return d > 0 && d <= 7;
    if (filter === 'expired') return d <= 0;
    return true;
  });

  return (
    <AdminPanelShell
      title="Users"
      subtitle="Search by Telegram ID or @username — extend or revoke VIP"
      icon={<User className="h-4 w-4" />}
      accent="#4C6FFF"
      maxWidth="max-w-[1000px]"
      onClose={onClose}
      error={error}
      onDismissError={() => setError('')}
      actions={
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/10"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      }
      toolbar={
        <PanelTabs<Filter>
          active={filter}
          onChange={setFilter}
          accent="#4C6FFF"
          tabs={[
            { key: 'all', label: 'All', badge: counts.all },
            { key: 'active', label: 'Active VIP', badge: counts.active },
            { key: 'expiring', label: 'Expiring ≤7d', badge: counts.expiring },
            { key: 'expired', label: 'Expired', badge: counts.expired },
          ]}
        />
      }
    >
        {/* The numbers an owner actually wants on opening this panel:
            how big is the paying base, how much of it is about to lapse,
            and how many have already gone. */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total subscribers', value: counts.all, tone: 'text-white' },
            { label: 'Active VIP', value: counts.active, tone: 'text-[#2FD98C]' },
            {
              label: 'Expiring in 7 days',
              value: counts.expiring,
              tone: counts.expiring > 0 ? 'text-[#FFC24D]' : 'text-white/40',
            },
            { label: 'Expired', value: counts.expired, tone: 'text-white/40' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className={`text-2xl font-black ${stat.tone}`}>{stat.value}</p>
              <p className="text-[11px] text-white/40">{stat.label}</p>
            </div>
          ))}
        </div>

        {Object.keys(activeByTier).length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/35">
              Active by plan
            </span>
            {Object.entries(activeByTier)
              .sort((a, b) => b[1] - a[1])
              .map(([tier, n]) => (
                <span
                  key={tier}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/60"
                >
                  <span className="font-mono uppercase text-white/40">{tier}</span>{' '}
                  <span className="font-bold text-white">{n}</span>
                </span>
              ))}
          </div>
        )}

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by Telegram ID or @username…"
            className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none focus:border-[#4C6FFF]/50"
          />
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-white/40">No subscribers match this view.</p>
          ) : (
            filtered.map((row) => {
              const left = daysLeft(row.expires_at);
              const active = left > 0;
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
                      {active && (
                        <span className={left <= 7 ? 'font-bold text-[#FFC24D]' : 'text-white/55'}>
                          {' '}· {left}d left
                        </span>
                      )}
                    </p>
                  </div>
                  <span
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold ${
                      active ? 'bg-[#4C6FFF]/15 text-[#4C6FFF]' : 'bg-white/10 text-white/40'
                    }`}
                  >
                    {active ? <ShieldCheck className="h-3 w-3" /> : <ShieldX className="h-3 w-3" />}
                    {active ? 'Active' : 'Expired'}
                  </span>
                  <button
                    onClick={() => extend(row, 7)}
                    disabled={busyId === row.telegram_user_id}
                    className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> 7d
                  </button>
                  <button
                    onClick={() => extend(row, 30)}
                    disabled={busyId === row.telegram_user_id}
                    className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" /> 30d
                  </button>
                  <button
                    onClick={() => revoke(row)}
                    disabled={busyId === row.telegram_user_id || !active}
                    className="flex items-center gap-1 rounded-xl border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-30"
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
