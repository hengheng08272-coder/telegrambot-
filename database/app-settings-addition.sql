-- A tiny key/value table for the handful of site-wide text strings that
-- should be editable from the Admin Panel without a code change — starting
-- with the scrolling ticker message under the header (previously hardcoded
-- in SupporterTicker.tsx).
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Readable by anyone (the ticker is public, unauthenticated content).
drop policy if exists "app_settings are publicly readable" on public.app_settings;
create policy "public_read_app_settings"
  on public.app_settings for select
  using (true);

-- Writes restricted to admins, same pattern every other admin-writable
-- table in this app already uses (profiles.is_admin, not just "any signed
-- in user" — viewers never get a Supabase Auth session at all, only the
-- admin does, but this keeps the policy consistent with the rest anyway).
drop policy if exists "app_settings are writable by authenticated users" on public.app_settings;
create policy "admin_write_app_settings"
  on public.app_settings for all
  using (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.is_admin = true))
  with check (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.is_admin = true));

insert into public.app_settings (key, value)
values ('ticker_message', 'សូមអរគុណដល់សមាជិកគ្រប់រូបដែលគាំទ្រ Nint Anime 💜')
on conflict (key) do nothing;

comment on table public.app_settings is
  'Small admin-editable site text, one row per key. Currently just ticker_message (the scrolling line under the header) — add more keys here as needed instead of a new table per string.';
