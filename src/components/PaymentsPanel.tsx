import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Loader2, ShieldOff, Wallet, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { PRICING_TIERS } from '@/lib/subscription';

interface Props {
  onClose: () => void;
}

interface Submission {
  id: string;
  telegram_user_id: string;
  telegram_username: string | null;
  tier: string;
  amount: number;
  screenshot_url: string;
  status: 'pending' | 'approved' | 'rejected';
  auto_approved: boolean;
  admin_confirmed: boolean;
  submitted_at: string;
}

function tierMonths(tierKey: string): number {
  return PRICING_TIERS.find((t) => t.key === tierKey)?.months ?? 1;
}

export default function PaymentsPanel({ onClose }: Props) {
  const [pendingItems, setPendingItems] = useState<Submission[]>([]);
  const [unconfirmedItems, setUnconfirmedItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [pendingRes, unconfirmedRes] = await Promise.all([
      supabase.from('payment_submissions').select('*').eq('status', 'pending').order('submitted_at', { ascending: false }),
      supabase
        .from('payment_submissions')
        .select('*')
        .eq('auto_approved', true)
        .eq('admin_confirmed', false)
        .order('submitted_at', { ascending: false }),
    ]);
    if (pendingRes.error) setError(pendingRes.error.message);
    setPendingItems(pendingRes.data ?? []);
    setUnconfirmedItems(unconfirmedRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const approve = async (sub: Submission) => {
    setBusyId(sub.id);
    setError('');

    // Extend from whichever is later: now, or their current expiry (so
    // renewing before it runs out stacks on top instead of resetting).
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('expires_at')
      .eq('telegram_user_id', sub.telegram_user_id)
      .maybeSingle();

    const base = existing?.expires_at && new Date(existing.expires_at) > new Date()
      ? new Date(existing.expires_at)
      : new Date();
    base.setMonth(base.getMonth() + tierMonths(sub.tier));

    const { error: upsertErr } = await supabase.from('subscriptions').upsert({
      telegram_user_id: sub.telegram_user_id,
      telegram_username: sub.telegram_username,
      tier: sub.tier,
      expires_at: base.toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (upsertErr) {
      setError(upsertErr.message);
      setBusyId(null);
      return;
    }

    await supabase
      .from('payment_submissions')
      .update({ status: 'approved', admin_confirmed: true, reviewed_at: new Date().toISOString() })
      .eq('id', sub.id);

    setBusyId(null);
    load();
  };

  const reject = async (sub: Submission) => {
    setBusyId(sub.id);
    await supabase
      .from('payment_submissions')
      .update({ status: 'rejected', admin_confirmed: true, reviewed_at: new Date().toISOString() })
      .eq('id', sub.id);
    setBusyId(null);
    load();
  };

  // The 30s auto-approve already granted VIP — this just marks it as
  // reviewed, nothing changes for the member.
  const confirmAuto = async (sub: Submission) => {
    setBusyId(sub.id);
    await supabase.from('payment_submissions').update({ admin_confirmed: true }).eq('id', sub.id);
    setBusyId(null);
    load();
  };

  // The screenshot turned out to be fake/wrong after the fact — end
  // their VIP immediately and mark the submission rejected.
  const revokeAuto = async (sub: Submission) => {
    setBusyId(sub.id);
    setError('');
    const { error: revokeErr } = await supabase
      .from('subscriptions')
      .update({ expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('telegram_user_id', sub.telegram_user_id);
    if (revokeErr) {
      setError(revokeErr.message);
      setBusyId(null);
      return;
    }
    await supabase
      .from('payment_submissions')
      .update({ status: 'rejected', admin_confirmed: true, reviewed_at: new Date().toISOString() })
      .eq('id', sub.id);
    setBusyId(null);
    load();
  };

  const renderCard = (sub: Submission, actions: ReactNode) => (
    <div key={sub.id} className="rounded-xl border border-[#FFC94A]/20 bg-[#FFC94A]/5 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-white">{sub.telegram_username ?? sub.telegram_user_id}</span>
        <span className="text-white/40">{new Date(sub.submitted_at).toLocaleString()}</span>
      </div>
      <div className="mb-2 flex items-center justify-between text-xs text-white/60">
        <span>Tier: {sub.tier}</span>
        <span className="font-bold text-[#FFC94A]">${sub.amount}</span>
      </div>
      <a href={sub.screenshot_url} target="_blank" rel="noreferrer">
        <img src={sub.screenshot_url} alt="Payment proof" className="mb-3 max-h-56 w-full rounded-lg object-contain" />
      </a>
      {actions}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#170D0C] p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Wallet className="h-4 w-4 text-[#FFC94A]" />
            <h2 className="text-sm font-bold">Payments</h2>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : (
            <>
              {unconfirmedItems.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Needs confirmation — auto-approved after 30s ({unconfirmedItems.length})
                  </div>
                  <div className="space-y-3">
                    {unconfirmedItems.map((sub) =>
                      renderCard(
                        sub,
                        <div className="flex gap-2">
                          <button
                            onClick={() => confirmAuto(sub)}
                            disabled={busyId === sub.id}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#22C55E] py-2 text-xs font-bold text-black transition disabled:opacity-50"
                          >
                            {busyId === sub.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Confirm
                          </button>
                          <button
                            onClick={() => revokeAuto(sub)}
                            disabled={busyId === sub.id}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 py-2 text-xs font-bold text-red-300 transition disabled:opacity-50"
                          >
                            <ShieldOff className="h-3.5 w-3.5" />
                            Revoke
                          </button>
                        </div>,
                      ),
                    )}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-bold text-white/70">Awaiting review ({pendingItems.length})</p>
                {pendingItems.length === 0 ? (
                  <p className="py-6 text-center text-xs text-white/40">No pending payments.</p>
                ) : (
                  <div className="space-y-3">
                    {pendingItems.map((sub) =>
                      renderCard(
                        sub,
                        <div className="flex gap-2">
                          <button
                            onClick={() => approve(sub)}
                            disabled={busyId === sub.id}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#22C55E] py-2 text-xs font-bold text-black transition disabled:opacity-50"
                          >
                            {busyId === sub.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Approve
                          </button>
                          <button
                            onClick={() => reject(sub)}
                            disabled={busyId === sub.id}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 py-2 text-xs font-bold text-red-300 transition disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </div>,
                      ),
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
