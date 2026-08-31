import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ShieldCheck, ShieldX, User, CalendarPlus, RefreshCw, Check, X } from 'lucide-react';
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

const DAY = 86_400_000;
const MAX_EXTEND_DAYS = 3650;

const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);

// dd/mm/yyyy with Latin digits — the admin reads these next to Telegram
// IDs and day counts, so Khmer numerals would only make them harder to
// scan.
const formatDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

// A tier key is only a key: the "2m" plan is currently sold as three
// months ($5, pricing_tiers.months = 3), so deriving the length from the
// key made the panel claim two months for a subscription that really
// runs three. The live table is the source of truth; the key is used
// only when a row references a tier that no longer exists there.
type TierInfo = { label: string; months: number };

function tierLabelFromKey(tier: string): string {
  const months = /^(\d+)m$/.exec(tier);
  if (!months) return tier;
  const n = Number(months[1]);
  return n % 12 === 0 ? `${n / 12} ឆ្នាំ` : `${n} ខែ`;
}

function tierLabel(tier: string, tiers: Record<string, TierInfo>): string {
  const known = tiers[tier];
  if (!known) return tierLabelFromKey(tier);
  return known.label || tierLabelFromKey(`${known.months}m`);
}

// Some rows were saved with the leading "@" already in the username, so
// rendering '@' + username produced "@@name" in the list.
function displayUsername(username: string | null): string | null {
  if (!username) return null;
  const clean = username.replace(/^@+/, '').trim();
  return clean ? `@${clean}` : null;
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
  // Which row has its "add days" editor open, and what has been typed
  // into it. Days are entered by hand rather than picked from fixed +7 /
  // +30 buttons, because the number granted usually comes from whatever
  // the viewer actually paid.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [daysInput, setDaysInput] = useState('');
  // key -> { label, months }, straight from pricing_tiers.
  const [tiers, setTiers] = useState<Record<string, TierInfo>>({});

  const load = async () => {
    setLoading(true);
    const [subs, plans] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('telegram_user_id, telegram_username, tier, expires_at, updated_at')
        .order('expires_at', { ascending: false }),
      supabase.from('pricing_tiers').select('key, label_km, months'),
    ]);
    if (subs.error) setError(subs.error.message);
    setRows(subs.data ?? []);
    // A failure here does not deserve an error banner: the list still
    // works, it just names plans after their key instead.
    if (plans.data) {
      setTiers(
        Object.fromEntries(
          plans.data.map((t) => [
            String(t.key),
            { label: String(t.label_km ?? '').trim(), months: Number(t.months) || 0 },
          ]),
        ),
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // Days are added on top of the current expiry when VIP is still live,
  // and from today when it has already lapsed — so extending an expired
  // member gives them the full number of days, not days that already
  // went by.
  const expiryAfterExtend = (row: SubRow, days: number) => {
    const base = new Date(row.expires_at) > new Date() ? new Date(row.expires_at) : new Date();
    base.setDate(base.getDate() + days);
    return base;
  };

  const extend = async (row: SubRow, days: number) => {
    setBusyId(row.telegram_user_id);
    setError('');
    const { error: err } = await supabase
      .from('subscriptions')
      .update({
        expires_at: expiryAfterExtend(row, days).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_user_id', row.telegram_user_id);
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setEditingId(null);
    setDaysInput('');
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

  const activeByTier = rows
    .filter((r) => daysLeft(r.expires_at) > 0)
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.tier] = (acc[r.tier] ?? 0) + 1;
      return acc;
    }, {});

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const q = query.trim().toLowerCase().replace(/^@+/, '');
        const matchesQuery =
          !q ||
          r.telegram_user_id.includes(q) ||
          (r.telegram_username ?? '').toLowerCase().replace(/^@+/, '').includes(q);
        if (!matchesQuery) return false;
        const d = daysLeft(r.expires_at);
        if (filter === 'active') return d > 0;
        if (filter === 'expiring') return d > 0 && d <= 7;
        if (filter === 'expired') return d <= 0;
        return true;
      }),
    [rows, query, filter],
  );

  const parsedDays = Number(daysInput);
  const daysValid = Number.isInteger(parsedDays) && parsedDays > 0 && parsedDays <= MAX_EXTEND_DAYS;

  return (
    <AdminPanelShell
      title="សមាជិក (Users)"
      subtitle="ស្វែងរកតាម Telegram ID ឬ @username — បន្ថែមថ្ងៃ ឬ ដកសិទ្ធិ VIP"
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
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> ផ្ទុកឡើងវិញ
        </button>
      }
      toolbar={
        <PanelTabs<Filter>
          active={filter}
          onChange={setFilter}
          accent="#4C6FFF"
          tabs={[
            { key: 'all', label: 'ទាំងអស់', badge: counts.all },
            { key: 'active', label: 'VIP សកម្ម', badge: counts.active },
            { key: 'expiring', label: 'ជិតផុត ≤៧ថ្ងៃ', badge: counts.expiring },
            { key: 'expired', label: 'ផុតកំណត់', badge: counts.expired },
          ]}
        />
      }
    >
        {/* The numbers an owner actually wants on opening this panel:
            how big is the paying base, how much of it is about to lapse,
            and how many have already gone. */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'សមាជិកសរុប', value: counts.all, tone: 'text-white' },
            { label: 'VIP សកម្ម', value: counts.active, tone: 'text-[#2FD98C]' },
            {
              label: 'ជិតផុតក្នុង ៧ថ្ងៃ',
              value: counts.expiring,
              tone: counts.expiring > 0 ? 'text-[#FFC24D]' : 'text-white/40',
            },
            { label: 'ផុតកំណត់ហើយ', value: counts.expired, tone: 'text-white/40' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className={`text-2xl font-black ${stat.tone}`}>{stat.value}</p>
              <p className="text-[11px] text-white/40">{stat.label}</p>
            </div>
          ))}
        </div>

        {Object.keys(activeByTier).length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-white/35">សកម្មតាមគម្រោង</span>
            {Object.entries(activeByTier)
              .sort((a, b) => b[1] - a[1])
              .map(([tier, n]) => (
                <span
                  key={tier}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/60"
                >
                  <span className="text-white/50">{tierLabel(tier, tiers)}</span>{' '}
                  <span className="font-bold text-white">{n}</span> នាក់
                </span>
              ))}
          </div>
        )}

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ស្វែងរកតាម Telegram ID ឬ @username…"
            className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none focus:border-[#4C6FFF]/50"
          />
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-white/40">មិនមានសមាជិកត្រូវនឹងទិដ្ឋភាពនេះទេ។</p>
          ) : (
            filtered.map((row) => {
              const left = daysLeft(row.expires_at);
              const active = left > 0;
              const soon = active && left <= 7;
              const busy = busyId === row.telegram_user_id;
              const editing = editingId === row.telegram_user_id;
              const name = displayUsername(row.telegram_username);
              return (
                <div
                  key={row.telegram_user_id}
                  // A coloured left edge makes the three states readable
                  // at a glance while scrolling, without reading any text.
                  className={`rounded-xl border border-white/10 bg-white/[0.03] p-3 ${
                    soon
                      ? 'border-l-[3px] border-l-[#FFC24D]'
                      : active
                        ? 'border-l-[3px] border-l-[#2FD98C]'
                        : 'border-l-[3px] border-l-white/15'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        {name ?? `ID ${row.telegram_user_id}`}
                      </p>
                      <p className="mt-0.5 text-[11px] text-white/45">
                        ID {row.telegram_user_id} · គម្រោង {tierLabel(row.tier, tiers)}
                      </p>
                      <p className="mt-0.5 text-[11px]">
                        <span className="text-white/45">
                          {active ? 'ផុតកំណត់ថ្ងៃ' : 'ផុតកំណត់តាំងពី'}{' '}
                          {formatDate(new Date(row.expires_at))}
                        </span>
                        {active && (
                          <span className={soon ? 'font-bold text-[#FFC24D]' : 'text-[#2FD98C]'}>
                            {' '}· នៅសល់ {left} ថ្ងៃ
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
                      {active ? 'សកម្ម' : 'ផុតកំណត់'}
                    </span>
                    <button
                      onClick={() => {
                        setEditingId(editing ? null : row.telegram_user_id);
                        setDaysInput('');
                      }}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-xl border border-[#4C6FFF]/30 bg-[#4C6FFF]/10 px-2.5 py-1 text-[11px] font-bold text-[#4C6FFF] transition hover:bg-[#4C6FFF]/20 disabled:opacity-50"
                    >
                      <CalendarPlus className="h-3 w-3" /> បន្ថែមថ្ងៃ
                    </button>
                    <button
                      onClick={() => revoke(row)}
                      disabled={busy || !active}
                      className="flex items-center gap-1 rounded-xl border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-30"
                    >
                      {busy && !editing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'ដកសិទ្ធិ'}
                    </button>
                  </div>

                  {editing && (
                    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                      <label className="mb-2 block text-[11px] font-bold text-white/50">
                        បញ្ចូលចំនួនថ្ងៃដែលចង់បន្ថែម (១–{MAX_EXTEND_DAYS})
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          autoFocus
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_EXTEND_DAYS}
                          value={daysInput}
                          onChange={(e) => setDaysInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && daysValid && !busy) extend(row, parsedDays);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          placeholder="ឧ. 30"
                          className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#4C6FFF]/50"
                        />
                        <span className="text-xs text-white/50">ថ្ងៃ</span>
                        <button
                          onClick={() => extend(row, parsedDays)}
                          disabled={!daysValid || busy}
                          className="flex items-center gap-1.5 rounded-full bg-[#4C6FFF] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#3D5BE0] disabled:opacity-40"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          បញ្ជាក់
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setDaysInput('');
                          }}
                          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 transition hover:bg-white/10"
                        >
                          <X className="h-3.5 w-3.5" /> បោះបង់
                        </button>
                      </div>
                      {/* Shows the exact date the change will produce, so
                          the admin can confirm before writing it. */}
                      <p className="mt-2 text-[11px] text-white/45">
                        {daysValid ? (
                          <>
                            ផុតកំណត់ថ្មី៖{' '}
                            <span className="font-bold text-[#2FD98C]">
                              {formatDate(expiryAfterExtend(row, parsedDays))}
                            </span>
                            {!active && ' (គិតចាប់ពីថ្ងៃនេះ ព្រោះផុតកំណត់ហើយ)'}
                          </>
                        ) : (
                          'បញ្ចូលចំនួនថ្ងៃជាលេខគត់ធំជាង ០ សិន។'
                        )}
                      </p>
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
