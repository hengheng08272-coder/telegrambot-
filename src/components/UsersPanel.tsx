import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Search,
  ShieldCheck,
  ShieldX,
  User,
  RefreshCw,
  Crown,
  Calendar,
  Tag,
  Check,
  Ban,
  Plus,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import AdminPanelShell, { PanelTabs } from '@/components/AdminPanelShell';
import { getEffectivePricingTiers, type PricingTier } from '@/lib/subscription';

interface Props {
  onClose: () => void;
}

type Filter = 'all' | 'active' | 'expiring' | 'expired';

interface SubRow {
  telegram_user_id: string;
  telegram_username: string | null;
  tier: string;
  expires_at: string;
  updated_at: string;
}

const PRESET_DAYS = [7, 30, 90];

export default function UsersPanel({ onClose }: Props) {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Which subscriber card currently has its custom-day input open.
  const [customOpenId, setCustomOpenId] = useState<string | null>(null);
  const [customDays, setCustomDays] = useState('');
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  const DAY = 86_400_000;
  const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);

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
    if (!days || days <= 0) return;
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
    setCustomOpenId(null);
    setCustomDays('');
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
    setConfirmRevokeId(null);
    if (err) {
      setError(err.message);
      return;
    }
    load();
  };

  const handleCustomSubmit = (row: SubRow) => {
    const n = parseInt(customDays, 10);
    if (!Number.isFinite(n) || n <= 0 || n > 3650) return;
    void extend(row, n);
  };

  const openCustom = (id: string) => {
    setCustomOpenId(id);
    setCustomDays('');
    setConfirmRevokeId(null);
    setTimeout(() => customInputRef.current?.focus(), 50);
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
      {/* Stat cards */}
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

      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by Telegram ID, @username, or plan name…"
          className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none focus:border-[#4C6FFF]/50"
        />
      </div>

      {/* Subscriber list */}
      <div className="space-y-2.5">
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
            const isBusy = busyId === row.telegram_user_id;
            const isCustomOpen = customOpenId === row.telegram_user_id;
            const isConfirmRevoke = confirmRevokeId === row.telegram_user_id;

            return (
              <div
                key={row.telegram_user_id}
                className={`rounded-xl border p-3.5 transition-colors ${
                  active
                    ? 'border-white/10 bg-white/[0.03]'
                    : 'border-red-500/15 bg-red-500/[0.02]'
                }`}
              >
                {/* ── Top: username + status ── */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        active ? 'bg-[#F5C563]/12' : 'bg-white/5'
                      }`}
                    >
                      {active ? (
                        <Crown className="h-4 w-4 text-[#F5C563]" />
                      ) : (
                        <ShieldX className="h-4 w-4 text-white/30" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold text-white">
                        {row.telegram_username ? '@' + row.telegram_username : row.telegram_user_id}
                      </p>
                      <p className="truncate text-[10px] text-white/30">
                        ID {row.telegram_user_id}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold ${
                      active ? 'bg-[#2FD98C]/15 text-[#2FD98C]' : 'bg-white/10 text-white/35'
                    }`}
                  >
                    {active ? <ShieldCheck className="h-3 w-3" /> : <ShieldX className="h-3 w-3" />}
                    {active ? 'Active' : 'Expired'}
                  </span>
                </div>

                {/* ── Info grid: plan / expiry / days-left ── */}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {/* Plan */}
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-white/30">
                      <Tag className="h-2.5 w-2.5" /> គម្រោង
                    </div>
                    <p className="mt-0.5 truncate text-[12px] font-bold text-white/85">{label}</p>
                    {price != null && (
                      <p className="text-[10px] text-white/35">
                        ${price}{months != null ? ` · ${months}ខែ` : ''}
                      </p>
                    )}
                  </div>

                  {/* Expiry date */}
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-white/30">
                      <Calendar className="h-2.5 w-2.5" /> ផុតកំណត់
                    </div>
                    <p className={`mt-0.5 text-[12px] font-bold ${active ? 'text-white/85' : 'text-red-300/70'}`}>
                      {fmtDate(row.expires_at)}
                    </p>
                    {!active && <p className="text-[10px] text-red-300/40">បានផុតរួច</p>}
                  </div>

                  {/* Days remaining */}
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-wide text-white/30">
                      នៅសល់
                    </div>
                    {active ? (
                      <>
                        <p
                          className={`mt-0.5 text-[16px] font-black leading-none ${
                            left <= 7 ? 'text-[#FFC24D]' : 'text-[#2FD98C]'
                          }`}
                        >
                          {left}
                          <span className="ml-0.5 text-[10px] font-medium text-white/35">ថ្ងៃ</span>
                        </p>
                        {months != null && (
                          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/8">
                            <div
                              className="h-full rounded-full"
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
                      </>
                    ) : (
                      <p className="mt-0.5 text-[12px] font-bold text-white/25">0 ថ្ងៃ</p>
                    )}
                  </div>
                </div>

                {/* ── Action row ── */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {PRESET_DAYS.map((d) => (
                    <button
                      key={d}
                      onClick={() => extend(row, d)}
                      disabled={isBusy}
                      className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-white/75 transition hover:border-[#2050D8]/30 hover:bg-[#2050D8]/10 hover:text-white disabled:opacity-40"
                    >
                      <Plus className="h-3 w-3" /> {d}ថ្ងៃ
                    </button>
                  ))}

                  {/* Custom day toggle */}
                  <button
                    onClick={() => (isCustomOpen ? setCustomOpenId(null) : openCustom(row.telegram_user_id))}
                    disabled={isBusy}
                    className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition disabled:opacity-40 ${
                      isCustomOpen
                        ? 'border-[#2050D8]/40 bg-[#2050D8]/15 text-[#4E86FF]'
                        : 'border-white/10 bg-white/5 text-white/75 hover:border-[#2050D8]/30 hover:bg-[#2050D8]/10'
                    }`}
                  >
                    <Plus className="h-3 w-3" /> ផ្សេងទៀត
                  </button>

                  {/* Revoke */}
                  <button
                    onClick={() => setConfirmRevokeId(row.telegram_user_id)}
                    disabled={isBusy || !active}
                    className="ml-auto flex items-center gap-1 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1.5 text-[11px] font-bold text-red-300/80 transition hover:bg-red-500/15 disabled:opacity-25"
                  >
                    <Ban className="h-3 w-3" /> ដក VIP
                  </button>
                </div>

                {/* ── Custom days input (expandable) ── */}
                {isCustomOpen && (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-[#2050D8]/20 bg-[#2050D8]/[0.06] p-2.5">
                    <input
                      ref={customInputRef}
                      type="number"
                      min={1}
                      max={3650}
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCustomSubmit(row);
                        }
                      }}
                      placeholder="បញ្ចូលចំនួនថ្ងៃ..."
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#2050D8]/50"
                    />
                    <span className="shrink-0 text-[11px] text-white/35">ថ្ងៃ</span>
                    <button
                      onClick={() => handleCustomSubmit(row)}
                      disabled={isBusy || !customDays || parseInt(customDays, 10) <= 0}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-[#2050D8] px-3 py-2 text-[11px] font-bold text-white transition hover:bg-[#1a3fae] disabled:opacity-40"
                    >
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      បន្ថែម
                    </button>
                  </div>
                )}

                {/* ── Revoke confirmation (expandable) ── */}
                {isConfirmRevoke && (
                  <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-2.5">
                    <p className="flex-1 text-[11px] text-red-200/70">
                      បញ្ជាក់ការដក VIP ពីអ្នកប្រើនេះ? សិទ្ធិ VIP នឹងផុតកំណត់ភ្លាមៗ។
                    </p>
                    <button
                      onClick={() => setConfirmRevokeId(null)}
                      disabled={isBusy}
                      className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-white/60 transition hover:bg-white/10"
                    >
                      បោះបង់
                    </button>
                    <button
                      onClick={() => revoke(row)}
                      disabled={isBusy}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-red-500 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-red-600 disabled:opacity-40"
                    >
                      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      បញ្ជាក់ដក
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </AdminPanelShell>
  );
}
