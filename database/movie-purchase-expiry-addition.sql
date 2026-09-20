-- =====================================================================
-- Movie tickets get a clock, like VIP tickets already had.
-- Applied as migration `movie_purchase_expiry_window`.
--
-- WHAT WAS WRONG. A movie_purchases row stayed 'pending' forever, and
-- create_movie_purchase handed the same row back on every reopen with
-- no age limit. A ticket opened hours earlier therefore came back with
-- its original bill number, the dialog had no countdown to show whether
-- the code was still good, and the bank matcher could attach a later,
-- unrelated payment to a purchase the viewer had walked away from.
--
-- The window is 150 seconds here, matching
-- expire_stale_payment_submission. The client counts 180 so its
-- countdown can never reach zero before the row qualifies.
-- =====================================================================

-- Tells an abandoned ticket apart from one an admin actually rejected.
alter table public.movie_purchases
  add column if not exists auto_expired boolean not null default false;

-- A ticket that already carries a receipt is never expired: that one is
-- waiting on the admin, not on the payer.
create or replace function public.expire_stale_movie_purchase(
  p_purchase_id uuid,
  p_telegram_user_id text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_updated integer;
begin
  update movie_purchases
     set status = 'rejected', auto_expired = true, reviewed_at = now()
   where id = p_purchase_id
     and telegram_user_id = p_telegram_user_id
     and status = 'pending'
     and screenshot_url is null
     and submitted_at < now() - interval '150 seconds';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

grant execute on function public.expire_stale_movie_purchase(uuid, text)
  to anon, authenticated, service_role;

-- The server half of the same rule. The client cannot be trusted to
-- expire its own ticket -- it may simply be closed -- so the reuse
-- lookup enforces the window itself, and sweeps anything past it first.
-- See the deployed definition for the full body; the two changed parts
-- are the sweep and the age guard on the reuse SELECT:
--
--   update movie_purchases
--      set status='rejected', auto_expired=true, reviewed_at=now()
--    where telegram_user_id = p_telegram_user_id
--      and show_id = p_show_id
--      and status = 'pending'
--      and screenshot_url is null
--      and submitted_at < now() - interval '150 seconds';
--
--   select m.id into v_id from movie_purchases m
--    where m.telegram_user_id = p_telegram_user_id
--      and m.show_id = p_show_id
--      and m.status = 'pending'
--      and (m.screenshot_url is not null
--           or m.submitted_at > now() - interval '150 seconds')
--    order by m.submitted_at desc
--    limit 1;
