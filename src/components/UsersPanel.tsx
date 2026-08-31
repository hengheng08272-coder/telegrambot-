import { useEffect, useState } from 'react';
import { Loader2, Search, ShieldCheck, ShieldX, User, Plus, RefreshCw, Crown, Calendar, Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import AdminPanelShell, { PanelTabs } from '@/components/AdminPanelShell';
import { getEffectivePricingTiers, type PricingTier } from '@/lib/subscription';

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
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const DAY = 86_400_000;
  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);

  // Build a lookup so the raw tier key ("2m") can be resolved to the
  // real label the admin set in the Subscriptions panel — "៣ ខែ",
  // months, price. Without this the panel shows the internal key, which
  // is meaningless to whoever is reading the list.
  const tierMap = new Map(tiers.map((t) => [t.key, t]));
  const tierLabel = (key: string) => tierMap.get(key)?.labelKm ?? key;
  const tierMonths = (key: string) => tierMap.get(key)?.months ?? null;
  const tierPrice = (key: string) => tierMap.get(key)?.price ?? null;

  const load = async () => {
    setLoading(true);
    const [subsRes, tierData] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('telegram_user_id, telegram_username, tier, expires_at, updated_at')
        .order('expires_at', { ascending: false }),
      getEffectivePricingTiers(),
    ]);
    if (subsRes.error) setError(subsRes.error.message);
    setRows(subsRes.data ?? []);
    setTiers(tierData);
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
      (r.telegram_username ?? '').toLowerCase().includes(q) ||
      tierLabel(r.tier).toLowerCase().includes(q);
    if (!matchesQuery) return false;
    const d = daysLeft(r.expires_at);
    if (filter === 'active') return d > 0;
    if (filter === 'expiring') return d > 0 && d <= 7;
    if (filter === 'expired') return d <= 0;
    return true;
  });

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <AdminPanelShell
      title="Users"
      subtitle="Search by Telegram ID, @username, or plan name — extend or revoke VIP"
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
                  <span className="font-bold text-white">{tierLabel(tier)}</span>
                  {tierPrice(tier) != null && <span className="text-white/40"> · ${tierPrice(tier)}</span>}
                  <span className="ml-1.5 font-bold text-[#2FD98C]">{n}</span>
                </span>
              ))}
          </div>
        )}

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by Telegram ID, @username, or plan name…"
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
              const label = tierLabel(row.tier);
              const months = tierMonths(row.tier);
              const price = tierPrice(row.tier);
              return (
                <div
                  key={row.telegram_user_id}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  {/* Row 1: identity + status badge */}
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {active && <Crown className="h-3.5 w-3.5 shrink-0 text-[#F5C563]" />}
                      <p className="truncate text-sm font-bold text-white">
                        {row.telegram_username ? '@' + row.telegram_username : row.telegram_user_id}
                      </p>
                    </div>
                    <span
                      className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold ${
                        active ? 'bg-[#2FD98C]/15 text-[#2FD98C]' : 'bg-white/10 text-white/40'
                      }`}
                    >
                      {active ? <ShieldCheck className="h-3 w-3" /> : <ShieldX className="h-3 w-3" />}
                      {active ? 'Active' : 'Expired'}
                    </span>
                  </div>

                  {/* Row 2: plan + price + months — the part that was
                      wrong before: it showed the raw key "2m" instead of
                      the real label "៣ ខែ", and never showed price or
                      how many months the plan grants. */}
                  <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/55">
                    <span className="flex items-center gap-1.5">
                      <Tag className="h-3 w-3 text-white/35" />
                      <span className="font-semibold text-white/80">{label}</span>
                      {months != null && <span className="text-white/35">· {months} ខែ</span>}
                      {price != null && <span className="text-white/35">· ${price}</span>}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3 w-3 text-white/35" />
                      <span className={active ? 'text-white/70' : 'text-red-300/70'}>
                        {active ? 'ផុតកំណត់' : 'បានផុត'} {fmtDate(row.expires_at)}
                      </span>
                    </span>
                  </div>

                  {/* Row 3: days remaining as a clear number + bar, the
                      thing the admin opens this screen to check. The
                      total-period denominator comes from the plan's own
                      months, so the bar reflects how far through what
                      they actually bought they are. */}
                  {active && (
                    <div className="mb-2.5">
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="text-white/40">នៅសល់</span>
                        <span className={`font-black ${left <= 7 ? 'text-[#FFC24D]' : 'text-[#2FD98C]'}`}>
                          {left} <span className="text-white/40">ថ្ងៃ</span>
                        </span>
                      </div>
                      {months != null && (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(0, (left / (months * 30)) * 100))}%`,
                              background:
                                left <= 7
                                  ? 'linear-gradient(90deg, #FFC24D, #E6231F)'
                                  : 'linear-gradient(90deg, #2FD98C, #2050D8)',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Row 4: action buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => extend(row, 7)}
                      disabled={busyId === row.telegram_user_id}
                      className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" /> +7ថ្ងៃ
                    </button>
                    <button
                      onClick={() => extend(row, 30)}
                      disabled={busyId === row.telegram_user_id}
                      className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" /> +30ថ្ងៃ
                    </button>
                    <button
                      onClick={() => extend(row, 90)}
                      disabled={busyId === row.telegram_user_id}
                      className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" /> +90ថ្ងៃ
                    </button>
                    <button
                      onClick={() => revoke(row)}
                      disabled={busyId === row.telegram_user_id || !active}
                      className="ml-auto flex items-center gap-1 rounded-xl border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-30"
                    >
                      {busyId === row.telegram_user_id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Revoke'}
                    </button>
                  </div>

                  <p className="mt-2 text-[10px] text-white/25">
                    ID {row.telegram_user_id}
                  </p>
                </div>
              );
            })
          )}
        </div>
    </AdminPanelShell>
  );
}
