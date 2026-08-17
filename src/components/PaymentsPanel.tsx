import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Loader2, ShieldOff, Wallet, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { PRICING_TIERS } from '@/lib/subscription';
import AdminPanelShell from '@/components/AdminPanelShell';

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
    <div key={sub.id} className="rounded-xl border border-[#E3B341]/20 bg-[#E3B341]/5 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-white">{sub.telegram_username ?? sub.telegram_user_id}</span>
        <span className="text-white/40">{new Date(sub.submitted_at).toLocaleString()}</span>
      </div>
      <div className="mb-2 flex items-center justify-between text-xs text-white/60">
        <span>Tier: {sub.tier}</span>
        <span className="font-bold text-[#E3B341]">${sub.amount}</span>
      </div>
      <a href={sub.screenshot_url} target="_blank" rel="noreferrer">
        <img src={sub.screenshot_url} alt="Payment proof" className="mb-3 max-h-56 w-full rounded-lg object-contain" />
      </a>
      {actions}
    </div>
  );

  return (
    <AdminPanelShell
      title="Payments"
      subtitle="Approve, confirm or reject VIP payment submissions"
      icon={<Wallet className="h-4 w-4" />}
      accent="#34B37A"
      maxWidth="max-w-[1000px]"
      onClose={onClose}
    >

        {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <div className="space-y-5">
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
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#34B37A] py-2 text-xs font-bold text-black transition disabled:opacity-50"
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
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#34B37A] py-2 text-xs font-bold text-black transition disabled:opacity-50"
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
    </AdminPanelShell>
  );
}
