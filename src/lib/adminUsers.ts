import { supabase } from '@/lib/supabase/supabaseClient';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { getTelegramInitData } from '@/lib/telegram';

/**
 * Managing who has keys.
 *
 * admin_users is unreachable from the browser on purpose — row level
 * security is on with no policies, so neither the anon key in the
 * bundle nor an admin's own session can read a single row. Everything
 * here therefore goes through the telegram-admin-manage function,
 * which re-verifies Telegram's signature over initData and re-reads the
 * caller's level from the table on every call. A plain admin holding a
 * real session gets the same refusal an outsider does.
 */

export interface AdminUser {
  telegram_user_id: string;
  role: 'admin' | 'super_admin';
  label: string | null;
  added_at: string;
  added_by: string | null;
}

export interface AdminUserList {
  /** The Telegram id of whoever is looking, so the UI can mark "you". */
  me: string;
  admins: AdminUser[];
}

// The function answers in codes rather than sentences, so the wording
// lives on this side where it can be read in the app's own voice.
const MESSAGES: Record<string, string> = {
  forbidden: 'មានតែ Super Admin ទេដែលអាចបន្ថែម ឬ ដក admin បាន។',
  unverified: 'មិនអាចផ្ទៀងផ្ទាត់ Telegram បានទេ — សូមបើកកម្មវិធីពី bot ម្ដងទៀត។',
  need_numeric_id: 'ត្រូវការលេខ Telegram ID ពិត (លេខសុទ្ធ) — @username មិនអាចប្រើបានទេ។',
  bad_role: 'តួនាទីមិនត្រឹមត្រូវ។',
  cannot_remove_self: 'អ្នកមិនអាចដកខ្លួនឯងបានទេ។',
  last_super_admin: 'នេះជា Super Admin ចុងក្រោយ — ដកមិនបានទេ ព្រោះនឹងគ្មាននរណាបន្ថែមបានវិញ។',
  not_configured: 'ម៉ាស៊ីនមេមិនទាន់រៀបចំរួច។',
};

async function call(payload: Record<string, unknown>): Promise<AdminUserList> {
  const initData = getTelegramInitData();
  if (!initData) throw new Error(MESSAGES.unverified);

  const { data, error } = await supabase.functions.invoke('telegram-admin-manage', {
    body: { ...payload, initData },
  });

  // functions.invoke turns a non-2xx into a FunctionsHttpError whose
  // own message is just the status, so the body is re-read to recover
  // the code the function actually sent.
  if (error) {
    const code = await extractFunctionErrorMessage(error, data);
    throw new Error(MESSAGES[code] ?? code);
  }

  if (data?.error) throw new Error(MESSAGES[data.error as string] ?? String(data.error));
  return { me: String(data?.me ?? ''), admins: (data?.admins ?? []) as AdminUser[] };
}

export const fetchAdminUsers = () => call({ action: 'list' });

export const addAdminUser = (input: {
  telegram_user_id: string;
  role: 'admin' | 'super_admin';
  label?: string;
}) => call({ action: 'add', ...input });

export const removeAdminUser = (telegramUserId: string) =>
  call({ action: 'remove', telegram_user_id: telegramUserId });
