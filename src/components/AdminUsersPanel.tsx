import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Trash2, Plus, Crown } from 'lucide-react';
import {
  fetchAdminUsers,
  addAdminUser,
  removeAdminUser,
  type AdminUser,
} from '@/lib/adminUsers';
import { errorMessage } from '@/lib/api';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

/**
 * Who holds keys, and the one place they are handed out and taken back.
 *
 * Before this panel, admin_users could only be edited with SQL, which
 * on a phone meant asking somebody else to do it. Removal in particular
 * had to stop being a favour: the owner has to be able to take a key
 * back the moment he decides to, without waiting for anyone.
 *
 * Every button here calls telegram-admin-manage, which re-checks the
 * caller's own level server-side — so rendering this panel is a
 * convenience, not the security boundary.
 */
export default function AdminUsersPanel({ onClose }: Props) {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [me, setMe] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [idDraft, setIdDraft] = useState('');
  const [labelDraft, setLabelDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState<'admin' | 'super_admin'>('admin');
  const [saving, setSaving] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminUsers();
      setAdmins(data.admins);
      setMe(data.me);
    } catch (e: unknown) {
      setError(errorMessage(e, 'Failed to load admins'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async () => {
    const id = idDraft.replace(/[^0-9]/g, '');
    if (!id) {
      setError('ត្រូវការលេខ Telegram ID ពិត (លេខសុទ្ធ) — @username មិនអាចប្រើបានទេ។');
      return;
    }
    setSaving('add');
    setError('');
    try {
      const data = await addAdminUser({
        telegram_user_id: id,
        role: roleDraft,
        label: labelDraft.trim() || undefined,
      });
      setAdmins(data.admins);
      setMe(data.me);
      setIdDraft('');
      setLabelDraft('');
      setRoleDraft('admin');
    } catch (e: unknown) {
      setError(errorMessage(e, 'Failed to add'));
    } finally {
      setSaving('');
    }
  };

  const handleRemove = async (admin: AdminUser) => {
    const who = admin.label || admin.telegram_user_id;
    if (!confirm(`ដកសិទ្ធិ admin ពី ${who}? គាត់នឹងលែងឃើញផ្ទាំងគ្រប់គ្រង និងលែងទទួលសារទូទាត់។`)) return;
    setSaving(admin.telegram_user_id);
    setError('');
    try {
      const data = await removeAdminUser(admin.telegram_user_id);
      setAdmins(data.admins);
      setMe(data.me);
    } catch (e: unknown) {
      setError(errorMessage(e, 'Failed to remove'));
    } finally {
      setSaving('');
    }
  };

  return (
    <AdminPanelShell
      title="Admins"
      subtitle="អ្នកដែលមានសិទ្ធិចូលផ្ទាំងគ្រប់គ្រង និងទទួលសារពេលមានការទូទាត់"
      icon={<ShieldCheck className="h-4 w-4" />}
      accent="#4C6FFF"
      maxWidth="max-w-[700px]"
      error={error}
      onDismissError={() => setError('')}
      onClose={onClose}
    >
      <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-white/50">Add an admin</p>
        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            value={idDraft}
            onChange={(e) => setIdDraft(e.target.value)}
            placeholder="Telegram ID (ឧ. 7836365582)"
            inputMode="numeric"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#4C6FFF]/50"
          />
          <input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            placeholder="ឈ្មោះ ឬ @username (សម្រាប់ចាំមុខ)"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[#4C6FFF]/50"
          />
        </div>

        {/* Two levels, said plainly. The difference decides who can
            touch prices, plans, the KHQR and this very list. */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(['admin', 'super_admin'] as const).map((role) => (
            <button
              key={role}
              onClick={() => setRoleDraft(role)}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                roleDraft === role
                  ? 'border-[#4C6FFF]/60 bg-[#4C6FFF]/15'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <p className="text-sm font-bold text-white">
                {role === 'admin' ? 'Admin' : 'Super Admin'}
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-white/45">
                {role === 'admin'
                  ? 'បញ្ជាក់ការទូទាត់ និងគ្រប់គ្រងមាតិកា'
                  : 'គ្រប់យ៉ាង — តម្លៃ, គម្រោង VIP, KHQR, admin'}
              </p>
            </button>
          ))}
        </div>

        <p className="mb-3 text-[11px] leading-relaxed text-white/40">
          ត្រូវប្រើលេខ ID មិនមែន @username ទេ ព្រោះ username អាចប្ដូរ ហើយអ្នកផ្សេងអាចយកទៅប្រើវិញបាន។
          រកលេខ ID៖ អោយគាត់ផ្ញើសារទៅ bot មួយដូចជា @userinfobot។
          បន្ទាប់ពីបន្ថែមរួច គាត់ត្រូវចុច Start ក្នុង bot របស់យើងម្ដង ទើបទទួលសារទូទាត់បាន។
        </p>

        <button
          onClick={handleAdd}
          disabled={saving === 'add'}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#4C6FFF] py-2.5 text-sm font-bold text-white transition hover:bg-[#3d5ae0] disabled:opacity-50"
        >
          {saving === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          បន្ថែម admin
        </button>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-white/40" />
          </div>
        ) : admins.length === 0 ? (
          <p className="py-6 text-center text-xs text-white/40">No admins yet.</p>
        ) : (
          admins.map((admin) => {
            const isMe = admin.telegram_user_id === me;
            const owner = admin.role === 'super_admin';
            // The last owner has nothing that could put him back, so the
            // server refuses to remove him; saying so up here is kinder
            // than letting the tap fail.
            const lastOwner = owner && admins.filter((a) => a.role === 'super_admin').length <= 1;
            return (
              <div
                key={admin.telegram_user_id}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                  owner
                    ? 'border-[#F5C563]/25 bg-[#F5C563]/[0.07]'
                    : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                    {owner && <Crown className="h-3.5 w-3.5 shrink-0 text-[#F5C563]" />}
                    {admin.label || admin.telegram_user_id}
                    {isMe && <span className="text-xs font-normal text-white/40">(អ្នក)</span>}
                  </p>
                  <p className="truncate text-xs text-white/45">
                    {owner ? 'Super Admin' : 'Admin'} · {admin.telegram_user_id}
                  </p>
                </div>
                {isMe || lastOwner ? (
                  <span className="shrink-0 text-[11px] text-white/30">ដកមិនបាន</span>
                ) : (
                  <button
                    onClick={() => handleRemove(admin)}
                    disabled={saving === admin.telegram_user_id}
                    className="flex shrink-0 items-center gap-1 rounded-xl border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {saving === admin.telegram_user_id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    ដក
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </AdminPanelShell>
  );
}
