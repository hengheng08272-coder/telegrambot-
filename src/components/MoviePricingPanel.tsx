import { useEffect, useMemo, useState } from 'react';
import { Check, DollarSign, Film, Loader2, Search } from 'lucide-react';
import AdminPanelShell from '@/components/AdminPanelShell';
import { supabase } from '@/lib/supabase/supabaseClient';
import { formatPrice, type Currency } from '@/lib/format';
import {
  FALLBACK_PRICING,
  fetchMoviePricing,
  priceOf,
  saveMoviePrice,
  saveMoviePricing,
  type MoviePricing,
} from '@/lib/moviePurchase';

interface Props {
  onClose: () => void;
}

interface Row {
  id: string;
  title: string;
  poster_url: string | null;
  banner_url: string | null;
  movie_price: number | null;
}

/**
 * What each film costs, and in what money.
 *
 * Two levels on purpose. The default at the top is the only number that
 * has to be maintained — set it once and every title follows it, which is
 * how a catalog of twenty films stays priced without twenty edits. A
 * per-title price is the exception, for the one release worth more than
 * the rest, and clearing it hands that title back to the default.
 *
 * The prices shown here are not what anyone is charged. create_movie_
 * purchase re-reads them server-side when a ticket is opened, so this
 * screen sets the catalog and the database enforces it — a viewer cannot
 * ask to be charged less than what is on this page.
 */
export default function MoviePricingPanel({ onClose }: Props) {
  const [pricing, setPricing] = useState<MoviePricing>(FALLBACK_PRICING);
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [defaultDraft, setDefaultDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const [live, list] = await Promise.all([
      fetchMoviePricing(),
      supabase
        .from('shows')
        .select('id, title, poster_url, banner_url, movie_price')
        .eq('type', 'movie')
        .order('created_at', { ascending: false }),
    ]);
    if (list.error) setError(list.error.message);
    setPricing(live);
    setDefaultDraft(String(live.defaultPrice));
    setRows((list.data ?? []) as Row[]);
    setDrafts(
      Object.fromEntries(
        ((list.data ?? []) as Row[]).map((r) => [
          r.id,
          r.movie_price === null || r.movie_price === undefined ? '' : String(r.movie_price),
        ]),
      ),
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flashSaved = (id: string) => {
    setSavedId(id);
    window.setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 1600);
  };

  const saveDefaults = async (next: MoviePricing) => {
    setSavingId('__default');
    setError('');
    const { error: err } = await saveMoviePricing(next);
    setSavingId(null);
    if (err) {
      setError(err);
      return;
    }
    setPricing(next);
    setDefaultDraft(String(next.defaultPrice));
    flashSaved('__default');
  };

  const commitDefault = () => {
    const parsed = Number(defaultDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDefaultDraft(String(pricing.defaultPrice));
      setError('Default price must be a number above 0.');
      return;
    }
    if (parsed === pricing.defaultPrice) return;
    saveDefaults({ ...pricing, defaultPrice: parsed });
  };

  const commitRow = async (row: Row) => {
    const raw = (drafts[row.id] ?? '').trim();
    // Empty is a real choice, not a mistake — it means "follow the
    // default", so it is stored as NULL rather than as a zero.
    const next = raw === '' ? null : Number(raw);
    if (next !== null && (!Number.isFinite(next) || next <= 0)) {
      setDrafts((d) => ({ ...d, [row.id]: row.movie_price === null ? '' : String(row.movie_price) }));
      setError('A title price must be a number above 0, or blank to use the default.');
      return;
    }
    if (next === row.movie_price) return;
    setSavingId(row.id);
    setError('');
    const { error: err } = await saveMoviePrice(row.id, next);
    setSavingId(null);
    if (err) {
      setError(err);
      return;
    }
    setRows((list) => list.map((r) => (r.id === row.id ? { ...r, movie_price: next } : r)));
    flashSaved(row.id);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const unit = pricing.currency === 'KHR' ? '៛' : '$';

  return (
    <AdminPanelShell
      title="Movie pricing"
      subtitle="What each film costs, and in which currency"
      icon={<DollarSign className="h-4 w-4" />}
      accent="#F5C563"
      maxWidth="max-w-[900px]"
      error={error}
      onDismissError={() => setError('')}
      onClose={onClose}
      toolbar={
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search movies…"
            className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none focus:border-[#F5C563]/50"
          />
        </div>
      }
    >
      {/* ---- Catalog-wide defaults ------------------------------------ */}
      <section className="rounded-2xl border border-[#F5C563]/20 bg-[#F5C563]/[0.04] p-4">
        <p className="text-sm font-bold text-white">Default for every movie</p>
        <p className="mt-1 text-xs leading-relaxed text-white/50">
          Every film without its own price is sold at this. Change it here and they all move
          together.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
            <span className="text-sm font-bold text-white/45">{unit}</span>
            <input
              value={defaultDraft}
              onChange={(e) => setDefaultDraft(e.target.value)}
              onBlur={commitDefault}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              inputMode="decimal"
              className="w-24 bg-transparent text-base font-bold tabular-nums text-white outline-none"
            />
            {savingId === '__default' ? (
              <Loader2 className="h-4 w-4 animate-spin text-white/40" />
            ) : savedId === '__default' ? (
              <Check className="h-4 w-4 text-[#2FD98C]" />
            ) : null}
          </div>

          {/* Currency is one choice for the whole catalog, not per film.
              A KHQR carries exactly one currency, and the ABA relay
              matches a payment by its amount — two currencies in one
              price list would make "4000" ambiguous the moment a riel
              film and a dollar film are both on sale. */}
          <div className="flex overflow-hidden rounded-xl border border-white/10">
            {(['USD', 'KHR'] as Currency[]).map((code) => (
              <button
                key={code}
                onClick={() => {
                  if (code !== pricing.currency) saveDefaults({ ...pricing, currency: code });
                }}
                className={`px-4 py-2 text-sm font-bold transition ${
                  pricing.currency === code
                    ? 'bg-[#F5C563] text-black'
                    : 'bg-white/[0.04] text-white/55 hover:bg-white/10'
                }`}
              >
                {code === 'KHR' ? '៛ KHR' : '$ USD'}
              </button>
            ))}
          </div>
        </div>

        {pricing.currency === 'KHR' && (
          <p className="mt-3 rounded-xl border border-[#FFC24D]/25 bg-[#FFC24D]/[0.06] px-3 py-2 text-xs leading-relaxed text-[#FFC24D]">
            Riel prices are written whole — no cents. If you paste a bank KHQR template under
            Subscriptions, it must also be a riel QR, or the generated code is refused rather than
            charging the wrong money.
          </p>
        )}
      </section>

      {/* ---- Per-title overrides -------------------------------------- */}
      <p className="mb-3 mt-6 text-xs leading-relaxed text-white/50">
        Leave a box empty to sell that film at the default. Fill it in only for the titles worth a
        different price.
      </p>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-white/40" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-8 text-center text-sm text-white/40">
          {rows.length === 0 ? 'No movies in the catalog yet.' : 'No movies match that search.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => {
            const art = row.poster_url ?? row.banner_url;
            const effective = priceOf(row, pricing);
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/30">
                  {art ? (
                    <img src={art} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Film className="h-4 w-4 text-white/25" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{row.title}</p>
                  <p className="mt-0.5 text-xs text-white/40">
                    {row.movie_price === null
                      ? `Default — sells at ${formatPrice(effective, pricing.currency)}`
                      : `Own price — ${formatPrice(effective, pricing.currency)}`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-2.5 py-1.5">
                  <span className="text-sm font-bold text-white/45">{unit}</span>
                  <input
                    value={drafts[row.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                    onBlur={() => commitRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    inputMode="decimal"
                    placeholder={String(pricing.defaultPrice)}
                    className="w-16 bg-transparent text-sm font-bold tabular-nums text-white placeholder-white/25 outline-none"
                  />
                  {savingId === row.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />
                  ) : savedId === row.id ? (
                    <Check className="h-3.5 w-3.5 text-[#2FD98C]" />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminPanelShell>
  );
}
