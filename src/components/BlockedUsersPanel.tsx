import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert, Trash2, Plus } from 'lucide-react';
import {
  fetchBlockedTelegramUsers,
  addBlockedTelegramUser,
  removeBlockedTelegramUser,
  type BlockedTelegramUser,
} from '@/lib/api';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

export default function BlockedUsersPanel({ onClose }: Props) {
  const [items, setItems] = useState<BlockedTelegramUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [idDraft, setIdDraft] = useState('');
  const [usernameDraft, setUsernameDraft] = useState('');
  const [reasonDraft, setReasonDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchBlockedTelegramUsers();
      setItems(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load blocked users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    const id = idDraft.trim();
    const username = usernameDraft.trim().replace(/^@/, '');
    if (!id && !username) {
      setError('Enter a Telegram ID or @username.');
      return;
    }
    setAdding(true);
    setError('');
    try {
      await addBlockedTelegramUser({
        telegram_user_id: id || undefined,
        telegram_username: username || undefined,
        reason: reasonDraft.trim() || undefined,
      });
      setIdDraft('');
      setUsernameDraft('');
      setReasonDraft('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Unblock this user?')) return;
    try {
      await removeBlockedTelegramUser(id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    }
  };

  return (
    <AdminPanelShell
      title="Blocked Users"
      subtitle="Telegram IDs/usernames blocked from the Mini App — they see an error screen instead of the app"
      icon={<ShieldAlert className="h-4 w-4" />}
      accent="#E6231F"
      maxWidth="max-w-[700px]"
      error={error}
      onDismissError={() => setError('')}
      onClose={onClose}
    >
      <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-white/50">Block a viewer</p>
        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            value={idDraft}
            onChange={(e) => setIdDraft(e.target.value)}
            placeholder="Telegram ID (ឧ. 123456789)"
            inputMode="numeric"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#E6231F]/50"
          />
          <input
            value={usernameDraft}
            onChange={(e) => setUsernameDraft(e.target.value)}
            placeholder="@username"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#E6231F]/50"
          />
        </div>
        <input
          value={reasonDraft}
          onChange={(e) => setReasonDraft(e.target.value)}
          placeholder="Reason (optional, internal note — not shown to the viewer)"
          className="mb-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#E6231F]/50"
        />
        <p className="mb-3 text-[11px] text-white/40">
          ត្រូវការតែមួយក៏បាន — ID ឬ @username។ ID ត្រូវជាលេខ Telegram ពិត (ឧ. ពី /start ក្នុង bot ឬ getUpdates), មិនមែន username ទេ។
        </p>
        <button
          onClick={handleAdd}
          disabled={adding}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#E6231F] py-2.5 text-sm font-bold text-white transition hover:bg-[#c91d19] disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Block
        </button>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-white/40" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/40">No blocked users yet.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[#E6231F]/20 bg-[#E6231F]/5 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {item.telegram_username ? `@${item.telegram_username}` : item.telegram_user_id}
                  {item.telegram_username && item.telegram_user_id && (
                    <span className="ml-1.5 text-xs font-normal text-white/40">({item.telegram_user_id})</span>
                  )}
                </p>
                {item.reason && <p className="truncate text-xs text-white/50">{item.reason}</p>}
              </div>
              <button
                onClick={() => handleRemove(item.id)}
                className="flex shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10"
              >
                <Trash2 className="h-3 w-3" /> Unblock
              </button>
            </div>
          ))
        )}
      </div>
    </AdminPanelShell>
  );
}
