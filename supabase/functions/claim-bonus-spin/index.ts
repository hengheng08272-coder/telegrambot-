import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Runs one VIP bonus draw, end to end, on the server.
//
// This exists because the draw used to run entirely in the browser
// (lib/spin.ts): the client picked the reward, inserted its own
// spin_claims row through a public INSERT policy, and then... stopped.
// Nothing anywhere read reward_days back and moved expires_at, and the
// client could not have done it itself either -- RLS only lets an admin
// or the service role write to `subscriptions`. So every winner was
// shown "you won 50 days" and received zero. The same public INSERT
// policy also meant anyone could POST themselves a 99999-day claim,
// which was harmless only for as long as the reward stayed unread.
//
// Doing the whole thing here fixes both at once: the pool, the roll,
// the eligibility check and the grant are all server-side, and the
// client's only input is which submission it wants to spin for.
//
// Requires no extra secrets beyond the SUPABASE_* pair every function
// already gets.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RewardTier {
  key: string;
  label: string;
  days: number;
  weight: number;
}

// Authoritative copy of the reward pools. lib/spin.ts keeps a matching
// copy purely to DRAW THE WHEEL -- the slices the viewer sees have to
// match the ones that can actually come up. Only this file decides what
// is won, so a tampered client can change what the wheel looks like and
// nothing else. Keep the two in sync when editing either.
const BONUS_POOLS: Record<string, RewardTier[]> = {
  // 1 Month / $3 -- 1 to 30 bonus days.
  "1m": [
    { key: "1d", label: "1 day", days: 1, weight: 30 },
    { key: "3d", label: "3 days", days: 3, weight: 22 },
    { key: "5d", label: "5 days", days: 5, weight: 16 },
    { key: "7d", label: "7 days", days: 7, weight: 12 },
    { key: "10d", label: "10 days", days: 10, weight: 8 },
    { key: "15d", label: "15 days", days: 15, weight: 5 },
    { key: "20d", label: "20 days", days: 20, weight: 3 },
    { key: "25d", label: "25 days", days: 25, weight: 2 },
    { key: "30d", label: "30 days", days: 30, weight: 2 },
  ],
  // Big Bonus / $5 -- 30 to 100 bonus days.
  "2m": [
    { key: "30d", label: "30 days", days: 30, weight: 28 },
    { key: "40d", label: "40 days", days: 40, weight: 20 },
    { key: "50d", label: "50 days", days: 50, weight: 16 },
    { key: "60d", label: "60 days", days: 60, weight: 12 },
    { key: "70d", label: "70 days", days: 70, weight: 9 },
    { key: "80d", label: "80 days", days: 80, weight: 7 },
    { key: "90d", label: "90 days", days: 90, weight: 5 },
    { key: "100d", label: "100 days", days: 100, weight: 3 },
  ],
  // 6 Months / $16 -- 20 to 120 bonus days. The longer plans had no pool
  // at all before, which meant the people who spent the most were the
  // only ones the draw never applied to.
  "6m": [
    { key: "20d", label: "20 days", days: 20, weight: 26 },
    { key: "30d", label: "30 days", days: 30, weight: 20 },
    { key: "40d", label: "40 days", days: 40, weight: 16 },
    { key: "50d", label: "50 days", days: 50, weight: 13 },
    { key: "60d", label: "60 days", days: 60, weight: 10 },
    { key: "80d", label: "80 days", days: 80, weight: 7 },
    { key: "100d", label: "100 days", days: 100, weight: 5 },
    { key: "120d", label: "120 days", days: 120, weight: 3 },
  ],
  // 12 Months / $27 -- 40 to 200 bonus days.
  "12m": [
    { key: "40d", label: "40 days", days: 40, weight: 26 },
    { key: "60d", label: "60 days", days: 60, weight: 20 },
    { key: "80d", label: "80 days", days: 80, weight: 16 },
    { key: "100d", label: "100 days", days: 100, weight: 13 },
    { key: "120d", label: "120 days", days: 120, weight: 10 },
    { key: "150d", label: "150 days", days: 150, weight: 7 },
    { key: "180d", label: "180 days", days: 180, weight: 5 },
    { key: "200d", label: "200 days", days: 200, weight: 3 },
  ],
};

function pickWeightedReward(pool: RewardTier[]): RewardTier {
  const total = pool.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * total;
  for (const tier of pool) {
    if (roll < tier.weight) return tier;
    roll -= tier.weight;
  }
  return pool[pool.length - 1];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { submission_id } = await req.json();
    if (!submission_id) return json({ error: "missing submission_id" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // The submission id is the only thing the caller supplies. Every
    // other fact -- whose purchase this is, which plan, whether it was
    // approved -- is read from the row here rather than trusted from
    // the request body, so a caller cannot spin on someone else's
    // behalf or claim a bigger plan than they bought.
    const { data: sub } = await admin
      .from("payment_submissions")
      .select("id, telegram_user_id, telegram_username, tier, status, bonus_spin_claimed")
      .eq("id", submission_id)
      .maybeSingle();

    if (!sub) return json({ error: "not_found" }, 404);
    if (sub.status !== "approved") return json({ error: "not_approved" }, 403);
    if (sub.bonus_spin_claimed) return json({ error: "already_used" }, 409);

    // VIP-only, and specifically ACTIVE VIP -- an approved purchase from
    // a year ago is not a live membership. Checked against the
    // subscription rather than the purchase for exactly that reason.
    const { data: subscription } = await admin
      .from("subscriptions")
      .select("expires_at")
      .eq("telegram_user_id", sub.telegram_user_id)
      .maybeSingle();

    const expiresAt = subscription?.expires_at ? new Date(subscription.expires_at) : null;
    if (!expiresAt || expiresAt <= new Date()) return json({ error: "not_vip" }, 403);

    // The admin can switch a tier's bonus off from Admin Panel ->
    // Subscriptions. A tier with no row at all keeps the default (on),
    // matching pricing_tiers.bonus_enabled's own DEFAULT true.
    const { data: tierRow } = await admin
      .from("pricing_tiers")
      .select("bonus_enabled")
      .eq("key", sub.tier)
      .maybeSingle();
    if (tierRow && tierRow.bonus_enabled === false) return json({ error: "bonus_disabled" }, 403);

    const pool = BONUS_POOLS[sub.tier];
    if (!pool) return json({ error: "no_pool" }, 403);

    // ---- the once-only guard ----
    // A conditional UPDATE is the whole lock. Postgres serialises the
    // two writers, so of two requests racing for the same submission
    // exactly one sees bonus_spin_claimed still false and updates a row;
    // the other matches nothing and gets zero rows back. Claiming the
    // flag BEFORE rolling the reward is deliberate: the failure mode is
    // then "flag burned, no days granted" (recoverable by the admin with
    // a Bonus grant) rather than "days granted twice".
    const { data: claimed, error: claimErr } = await admin
      .from("payment_submissions")
      .update({ bonus_spin_claimed: true })
      .eq("id", sub.id)
      .eq("status", "approved")
      .eq("bonus_spin_claimed", false)
      .select("id");

    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!claimed || claimed.length === 0) return json({ error: "already_used" }, 409);

    const reward = pickWeightedReward(pool);

    // Stack on top of whatever is left, never overwrite it -- the whole
    // point of the bonus is that it is time ADDED to the membership.
    const base = expiresAt > new Date() ? new Date(expiresAt) : new Date();
    base.setDate(base.getDate() + reward.days);
    const newExpiresAt = base.toISOString();

    const { error: grantErr } = await admin
      .from("subscriptions")
      .update({ expires_at: newExpiresAt, updated_at: new Date().toISOString() })
      .eq("telegram_user_id", sub.telegram_user_id);

    if (grantErr) {
      // Hand the spin back rather than burning it on a grant that never
      // landed.
      await admin
        .from("payment_submissions")
        .update({ bonus_spin_claimed: false })
        .eq("id", sub.id);
      return json({ error: grantErr.message }, 500);
    }

    // Audit trail. Written after the grant, and deliberately not fatal:
    // a claim that is missing its log row is a bookkeeping problem, but
    // failing the request here would show the viewer an error for days
    // they have already been given.
    await admin.from("spin_claims").insert({
      telegram_user_id: sub.telegram_user_id,
      telegram_username: sub.telegram_username,
      source: `purchase:${sub.id}`,
      reward_days: reward.days,
      reward_label: reward.label,
    });

    return json({
      reward_days: reward.days,
      reward_label: reward.label,
      expires_at: newExpiresAt,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
