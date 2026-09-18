import { useEffect, useState } from 'react';
import { Check, Film, Loader2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { formatPrice } from '@/lib/format';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

interface Purchase {
  id: string;
  telegram_user_id: string;
  telegram_username: string | null;
  show_id: string;
  amount: number;
  /** Older rows predate per-title pricing and carry no currency; they
   *  were all dollars, which is what the fallback says. */
  currency?: string | null;
  screenshot_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  auto_approved: boolean;
  admin_confirmed: boolean;
  submitted_at: string;
}

/**
 * Approving a standalone film purchase.
 *
 * This screen did not exist, and its absence was the whole reason a $1
 * receipt could not be made to wait for a human: the only place a movie
 * could be reviewed was the Telegram Confirm button, which marks a row
 * as looked-at without granting anything. So turning off the automatic
 * unlock would have left a buyer with no route at all.
 *
 * Approve here is the real decision — it is what sets status to
 * `approved`, which is the single thing episode-stream checks before it
 * will hand that buyer a video URL.
 */
export default function MoviePurchasesPanel({ onClose }: Props) {
  const [pending, setPending] = useState<Purchase[]>([]);
  const [unconfirmed, setUnconfirmed] = useState<Purchase[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [pendingRes, unconfirmedRes] = await Promise.all([
      supabase
        .from('movie_purchases')
        .select('*')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: false }),
      // Rows unlocked automatically before receipts started waiting for a
      // human. They are already watchable, so this is a review queue, not
      // an approval one — but it must not silently disappear.
      supabase
        .from('movie_purchases')
        .select('*')
        .eq('auto_approved', true)
        .eq('admin_confirmed', false)
        .order('submitted_at', { ascending: false }),
    ]);
    if (pendingRes.error) setError(pendingRes.error.message);
    const rows = [...(pendingRes.data ?? []), ...(unconfirmedRes.data ?? [])] as Purchase[];
    setPending((pendingRes.data ?? []) as Purchase[]);
    setUnconfirmed((unconfirmedRes.data ?? []) as Purchase[]);

    // One lookup for every film mentioned, rather than a join: the list
    // is short and this keeps the query above a plain select the RLS
    // policy already allows.
    const ids = [...new Set(rows.map((r) => r.show_id))];
    if (ids.length > 0) {
      const { data: shows } = await supabase.from('shows').select('id, title').in('id', ids);
      setTitles(Object.fromEntries((shows ?? []).map((s) => [s.id, s.title])));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (row: Purchase, approved: boolean) => {
    setBusyId(row.id);
    setError('');
    const { error: err } = await supabase
      .from('movie_purchases')
      .update({
        status: approved ? 'approved' : 'rejected',
        admin_confirmed: true,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (err) setError(err.message);
    setBusyId(null);
    load();
  };

  const card = (row: Purchase, showApprove: boolean) => (
    <div
      key={row.id}
      className="rounded-[14px] border border-white/10 bg-[#111a2e] p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold text-[#EEF1F8]">
          {titles[row.show_id] ?? row.show_id}
        </span>
        <span className="text-[13px] font-bold text-[#2FD98C]">
          {formatPrice(Number(row.amount), row.currency === 'KHR' ? 'KHR' : 'USD')}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-[#9AA4BD]">
        {row.telegram_username ? `@${row.telegram_username}` : row.telegram_user_id} ·{' '}
        {new Date(row.submitted_at).toLocaleString()}
      </p>

      {row.screenshot_url && (
        <a href={row.screenshot_url} target="_blank" rel="noreferrer" className="mt-2.5 block">
          <img
            src={row.screenshot_url}
            alt=""
            className="max-h-56 w-auto rounded-[10px] border border-white/10"
          />
        </a>
      )}

      <div className="mt-3 flex gap-2">
        {showApprove && (
          <button
            onClick={() => decide(row, true)}
            disabled={busyId === row.id}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#2FD98C]/15 px-3 py-2 text-[12px] font-bold text-[#2FD98C] ring-1 ring-inset ring-[#2FD98C]/35 transition active:scale-95 disabled:opacity-50"
          >
            {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            អនុម័ត
          </button>
        )}
        <button
          onClick={() => decide(row, false)}
          disabled={busyId === row.id}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#E6231F]/12 px-3 py-2 text-[12px] font-bold text-[#FF6B60] ring-1 ring-inset ring-[#E6231F]/35 transition active:scale-95 disabled:opacity-50"
        >
          <XCircle className="h-3.5 w-3.5" />
          បដិសេធ
        </button>
      </div>
    </div>
  );

  return (
    <AdminPanelShell
      title="ការទិញរឿង"
      subtitle="អនុម័តវិក្កយបត្រការទិញរឿង មុននឹងដោះសោ"
      icon={<Film className="h-5 w-5" />}
      error={error}
      onDismissError={() => setError('')}
      onClose={onClose}
    >
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[#9AA4BD]" />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h3 className="mb-2.5 text-[13px] font-bold text-[#EEF1F8]">
              រង់ចាំអនុម័ត ({pending.length})
            </h3>
            {pending.length === 0 ? (
              <p className="text-[12px] text-[#6A7591]">គ្មានវិក្កយបត្ររង់ចាំទេ។</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">{pending.map((r) => card(r, true))}</div>
            )}
          </section>

          {unconfirmed.length > 0 && (
            <section>
              <h3 className="mb-2.5 text-[13px] font-bold text-[#EEF1F8]">
                ដោះសោរួច — រង់ចាំពិនិត្យ ({unconfirmed.length})
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">{unconfirmed.map((r) => card(r, false))}</div>
            </section>
          )}
        </div>
      )}
    </AdminPanelShell>
  );
}
