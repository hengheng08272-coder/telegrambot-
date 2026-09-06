/*
# Lock down spin_claims inserts (addition)

Run this ONLY AFTER the claim-bonus-spin edge function is deployed.

Background: the bonus draw used to run in the browser. The client picked
its own reward and inserted its own spin_claims row through a public
INSERT policy — so anyone could POST themselves a row claiming any
number of days. That was harmless only because nothing ever read
reward_days back and granted it.

Now that claim-bonus-spin actually turns a claim into VIP days, that
policy is a way to mint them. The edge function uses the service-role
key, which bypasses RLS entirely, so removing the public INSERT costs
the app nothing.

Public SELECT stays: the app reads spin_claims to show a viewer their
own history, and the rows hold no secrets.
*/

DROP POLICY IF EXISTS "public_insert_spin_claims" ON spin_claims;

-- Backstop against a double claim even if two requests somehow get past
-- the conditional UPDATE in the edge function. Already created by
-- bonus-spin-addition.sql; repeated here so a project that only runs
-- this file still ends up protected.
CREATE UNIQUE INDEX IF NOT EXISTS spin_claims_one_per_source
  ON spin_claims(telegram_user_id, source);
