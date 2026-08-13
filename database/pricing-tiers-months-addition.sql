-- Lets the admin change how many months each pricing tier grants (Admin
-- Panel -> Subscriptions -> "Duration"), instead of that number being
-- hardcoded in three different edge functions (telegram-admin-bot,
-- auto-approve-payment, aba-payment-webhook — all now read this column
-- live, with the old hardcoded map kept only as a fallback if the column
-- is ever missing).
alter table public.pricing_tiers
  add column if not exists months integer not null default 1;

comment on column public.pricing_tiers.months is
  'How many months this tier extends a subscription by when purchased.';

update public.pricing_tiers set months = 1 where key = '1m';
update public.pricing_tiers set months = 2 where key = '2m';
update public.pricing_tiers set months = 6 where key = '6m';
update public.pricing_tiers set months = 12 where key = '12m';
