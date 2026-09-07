import { useEffect, useMemo, useState } from 'react';
import { AlignLeft, Check, Crown, Gift, Loader2, Radio, Save, Search, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { errorMessage } from '@/lib/api';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

interface SynopsisRow {
  id: string;
  title: string;
  poster_url: string | null;
  synopsis: string | null;
  type: string | null;
  status: string | null;
  release_year: number | null;
  is_free: boolean | null;
  episodes: { count: number }[] | null;
}

// The group post shows only the first 220 characters of a synopsis (see
// telegram-auto-post), so that is the number worth writing to. Anything
// past it still shows in full on the show's own detail screen.
const POST_PREVIEW_CHARS = 220;

/**
 * Fill in the missing synopses, in one list.
 *
 * 26 of 44 shows had no synopsis at all — including every one of the
 * eight in the auto-post queue, so every post going into the group was a
 * poster, a title, and a price, with nothing saying what the show is.
 * That is a plausible part of why 44 shows convert so few memberships,
 * and no amount of caption design fixes it: the words do not exist.
 *
 * Writing them through the Edit Show modal means opening, scrolling,
 * typing, saving and closing, twenty-six times. This is the same job as
 * one scrollable list: the shows that post soonest first, a box to type
 * in, and a counter showing where the group post will cut the text off.
 */
export default function SynopsisPanel({ onClose }: Props) {
  const [rows, setRows] = useState<SynopsisRow[]>([]);
  const [queueIds, setQueueIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [showsRes, queueRes] = await Promise.all([
        supabase
          .from('shows')
          .select('id, title, poster_url, synopsis, type, status, release_year, is_free, episodes(count)')
          .eq('coming_soon', false)
          .order('title'),
        supabase.from('telegram_auto_post_queue').select('show_id'),
      ]);
      if (!active) return;
      if (showsRes.error) {
        setError(errorMessage(showsRes.error, 'Failed to load shows'));
      } else {
        setRows((showsRes.data ?? []) as SynopsisRow[]);
      }
      setQueueIds(new Set((queueRes.data ?? []).map((r) => r.show_id as string)));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const episodeCount = (row: SynopsisRow) => row.episodes?.[0]?.count ?? 0;
  const isMissing = (row: SynopsisRow) => (row.synopsis ?? '').trim() === '';

  const filled = rows.filter((r) => !isMissing(r)).length;

  // Whatever posts soonest comes first: the auto-post queue, then the
  // long-running shows, which are both the biggest catalogue draw and
  // the ones a missing description costs the most.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => (showAll || isMissing(r)) && (!q || r.title.toLowerCase().includes(q)))
      .sort((a, b) => {
        const queued = Number(queueIds.has(b.id)) - Number(queueIds.has(a.id));
        if (queued !== 0) return queued;
        const missing = Number(isMissing(b)) - Number(isMissing(a));
        if (missing !== 0) return missing;
        return episodeCount(b) - episodeCount(a);
      });
  }, [rows, queueIds, query, showAll]);

  const save = async (row: SynopsisRow) => {
    const value = (drafts[row.id] ?? row.synopsis ?? '').trim();
    setSavingId(row.id);
    setError('');
    const { error: err } = await supabase
      .from('shows')
      .update({ synopsis: value || null })
      .eq('id', row.id);
    setSavingId(null);
    if (err) {
      setError(errorMessage(err, 'Failed to save'));
      return;
    }
    // Update in place rather than refetching: the list is sorted by
    // "missing first", so a refetch would make the row jump away the
    // instant it is saved and scroll the next one under the cursor.
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, synopsis: value || null } : r)));
    setSavedId(row.id);
    window.setTimeout(() => setSavedId((id) => (id === row.id ? null : id)), 1800);
  };

  return (
    <AdminPanelShell
      title="Synopsis"
      subtitle="រឿងដែលគ្មានសេចក្តីសង្ខេប — បំពេញនៅទីនេះ ដើម្បីឲ្យ post ក្នុង group មានអ្វីនិយាយ"
      icon={<AlignLeft className="h-4 w-4" />}
      accent="#4E86FF"
      error={error}
      onDismissError={() => setError('')}
      onClose={onClose}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="រកឈ្មោះរឿង…"
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-sm text-white outline-none"
            />
          </div>
          <button
            onClick={() => setShowAll((v) => !v)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
              showAll
                ? 'border-white/20 bg-white/10 text-white'
                : 'border-white/10 text-white/60 hover:bg-white/5'
            }`}
          >
            {showAll ? 'បង្ហាញទាំងអស់' : 'តែរឿងគ្មាន synopsis'}
          </button>
          <span className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs tabular-nums text-white/50">
            {filled} / {rows.length} មានរួច
          </span>
        </div>
      }
    >
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-white/40" />
        </div>
      ) : visible.length === 0 ? (
        <p className="py-20 text-center text-sm text-white/40">
          {showAll ? 'រកមិនឃើញ' : '🎉 រឿងទាំងអស់មាន synopsis រួចហើយ'}
        </p>
      ) : (
        <div className="space-y-3 pb-8">
          {visible.map((row) => {
            const draft = drafts[row.id] ?? row.synopsis ?? '';
            const dirty = draft.trim() !== (row.synopsis ?? '').trim();
            const eps = episodeCount(row);
            return (
              <div
                key={row.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4"
              >
                <div className="flex gap-3">
                  <div className="h-[72px] w-12 shrink-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10">
                    {row.poster_url && (
                      <img src={row.poster_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="truncate text-sm font-bold text-white">{row.title}</h3>
                      {queueIds.has(row.id) && (
                        // The eight shows that post soonest. Filling these
                        // first is the change the group actually sees.
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#4E86FF]/15 px-1.5 py-0.5 text-[9.5px] font-bold text-[#4E86FF] ring-1 ring-inset ring-[#4E86FF]/30">
                          <Send className="h-2.5 w-2.5" /> ក្នុង queue
                        </span>
                      )}
                      {row.is_free ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#2FD98C]/15 px-1.5 py-0.5 text-[9.5px] font-bold text-[#2FD98C] ring-1 ring-inset ring-[#2FD98C]/30">
                          <Gift className="h-2.5 w-2.5" /> ឥតគិតថ្លៃ
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#F5C563]/12 px-1.5 py-0.5 text-[9.5px] font-bold text-[#F5C563] ring-1 ring-inset ring-[#F5C563]/30">
                          <Crown className="h-2.5 w-2.5" /> VIP
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-white/40">
                      {eps > 0 && <span className="tabular-nums">{eps} ភាគ</span>}
                      {row.release_year && <span className="tabular-nums">{row.release_year}</span>}
                      {row.status === 'ongoing' && (
                        <span className="inline-flex items-center gap-1">
                          <Radio className="h-2.5 w-2.5" /> កំពុងចាក់
                        </span>
                      )}
                      {row.status === 'completed' && <span>ចប់ហើយ</span>}
                    </p>
                  </div>
                </div>

                <textarea
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                  rows={3}
                  placeholder="សរសេររឿងនេះនិយាយអំពីអ្វី ២–៣ ប្រយោគ…"
                  className="mt-3 w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-[#4E86FF]/50"
                />

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* The group post cuts at 220 characters, so the counter
                      measures against that rather than against nothing.
                      Past it is allowed — the detail screen shows the
                      whole thing — it just stops being what the post says. */}
                  <span
                    className={`text-[11px] tabular-nums ${
                      draft.length > POST_PREVIEW_CHARS ? 'text-[#FFC24D]' : 'text-white/35'
                    }`}
                  >
                    {draft.length} / {POST_PREVIEW_CHARS} តួ
                    {draft.length > POST_PREVIEW_CHARS && ' — post នឹងកាត់ត្រឹមនេះ'}
                  </span>
                  <button
                    onClick={() => save(row)}
                    disabled={!dirty || savingId === row.id}
                    className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#2050D8] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#4E86FF] disabled:opacity-40"
                  >
                    {savingId === row.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : savedId === row.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {savedId === row.id ? 'រក្សាទុករួច' : 'រក្សាទុក'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminPanelShell>
  );
}
