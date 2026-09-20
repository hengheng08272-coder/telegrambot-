-- =====================================================================
-- Passwordless admin, bound to verified Telegram identity.
-- Applied as migration `telegram_admin_roles`.
--
-- WHY THE EDGE FUNCTION EXISTS. The app's getIdentity() reads the
-- Telegram user in the BROWSER and passes the id to SECURITY DEFINER
-- RPCs as an ordinary parameter, and the anon key ships inside the JS
-- bundle. That is acceptable for "which tickets are mine" -- the worst
-- case is somebody reading their own rows -- but it cannot carry
-- privilege: the owner's numeric id is public (it appears in any
-- screenshot of the admin bot), so "admin = this id" checked anywhere
-- the client can reach would hand the whole platform to anyone who
-- read the bundle.
--
-- So admin_users is never exposed to the browser at all. The only
-- reader is supabase/functions/telegram-admin-session, which first
-- verifies Telegram's signed initData against the bot token -- a secret
-- the browser never sees -- and only then mints a session.
-- =====================================================================

-- Keyed on the NUMERIC id, not the @username: a username can be
-- changed, released and claimed by somebody else, so binding rights to
-- one would let an outsider inherit them by picking up a dropped
-- handle. The numeric id is permanent and cannot be transferred.
create table if not exists public.admin_users (
  telegram_user_id text primary key,
  role             text not null check (role in ('admin', 'super_admin')),
  label            text,
  added_at         timestamptz not null default now(),
  added_by         text
);

alter table public.admin_users enable row level security;

-- Deliberately no policies: RLS with none denies anon and authenticated
-- outright, while the service role bypasses RLS.
revoke all on public.admin_users from anon, authenticated;

insert into public.admin_users (telegram_user_id, role, label, added_by)
values
  ('8769719333', 'super_admin', '@NintPlexminiapp', 'owner'),
  ('7836365582', 'admin',       '@Abdusf252363',    'owner')
on conflict (telegram_user_id) do update
  set role = excluded.role,
      label = excluded.label;

-- The level a session was minted at. is_admin stays the gate for "sees
-- the panel at all"; this says how much of it is live.
alter table public.profiles
  add column if not exists admin_role text
  check (admin_role is null or admin_role in ('admin', 'super_admin'));

-- TO REVOKE SOMEBODY: delete their admin_users row. The edge function
-- clears is_admin and admin_role on their next open, so removing the
-- row is the whole gesture.
--
-- That is still true, but it is no longer the only way. The owner can
-- now do it from the phone: admin panel -> Admins, which calls the
-- telegram-admin-manage edge function. Same table, same rule, with two
-- guards SQL by hand does not have -- you cannot remove yourself, and
-- the last super_admin cannot be removed, because either one would
-- leave nobody able to add anybody back.
