// =====================================================================
// !! THIS FILE IS BEHIND PRODUCTION -- DO NOT DEPLOY FROM IT !!
// ---------------------------------------------------------------------
// The live version of this function on Supabase project
// dowjxhkijtlsdvhyuddt is NEWER and has features this copy does not.
// Deploying this file would silently remove them.
//
// Before touching this function: open Supabase Dashboard -> Edge
// Functions -> this function -> copy the live source over this file
// FIRST, then make your change, then deploy.
//
// (This drift happened because several fixes were applied straight to
// the dashboard without being copied back into the repo.)
// =====================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Called from the VIP payment screen when the viewer attaches a receipt
// photo instead of waiting for the ABA auto-confirm webhook to match
// their payment. This is the "faster path" the caption under the QR
// promises.
//
// WHY THIS GRANTS VIP IMMEDIATELY
// The alternative — hold the viewer on a spinner until the admin taps
// Approve — means anyone paying at 2am waits until morning, which is the
// exact frustration this whole flow exists to remove. So the grant is
// optimistic: VIP unlocks now, the submission is flagged auto_approved,
// and the admin gets the actual photo in Telegram with Confirm/Revoke
// buttons. A fake receipt therefore buys minutes, not months — but it is
// a real tradeoff, not a free win. If fraud ever becomes a problem, flip
// AUTO_GRANT_ON_PROOF to false below: the photo still reaches the admin,
// the viewer just waits for the tap.
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_BOT_TOKEN     - same bot used elsewhere
//   TELEGRAM_ADMIN_CHAT_ID - your personal Telegram chat id

const AUTO_GRANT_ON_PROOF = true;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// Fallback only — the live source of truth is pricing_tiers.months,
// editable from Admin Panel -> Subscriptions -> "Duration".
const TIER_MONTHS_FALLBACK: Record<string, number> = {
  "1m": 1,
  "2m": 2,
  "6m": 6,
  "12m": 12,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { submission_id, screenshot_url } = await req.json();
    if (!submission_id || !screenshot_url) {
      return new Response(JSON.stringify({ error: "missing submission_id or screenshot_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: sub } = await admin
      .from("payment_submissions")
      .select("*")
      .eq("id", submission_id)
      .maybeSingle();

    if (!sub) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Attach the photo to the ticket first, whatever happens next. This
    // also takes the row out of the client's auto-expire path (that SQL
    // helper only closes tickets with no screenshot).
    await admin
      .from("payment_submissions")
      .update({ screenshot_url })
      .eq("id", submission_id);

    // Already decided (ABA matched while they were uploading, or the
    // admin was quick) — no-op, not an error.
    if (sub.status !== "pending") {
      return new Response(JSON.stringify({ ok: true, alreadyHandled: true, status: sub.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (AUTO_GRANT_ON_PROOF) {
      const { data: tierRow } = await admin
        .from("pricing_tiers")
        .select("months")
        .eq("key", sub.tier)
        .maybeSingle();
      const months = tierRow?.months ?? TIER_MONTHS_FALLBACK[sub.tier] ?? 1;

      const { data: existing } = await admin
        .from("subscriptions")
        .select("expires_at")
        .eq("telegram_user_id", sub.telegram_user_id)
        .maybeSingle();

      // Stack onto whatever is left rather than overwriting it, so
      // renewing early never costs the viewer days they already paid for.
      const base =
        existing?.expires_at && new Date(existing.expires_at) > new Date()
          ? new Date(existing.expires_at)
          : new Date();
      base.setMonth(base.getMonth() + months);

      await admin.from("subscriptions").upsert({
        telegram_user_id: sub.telegram_user_id,
        telegram_username: sub.telegram_username,
        tier: sub.tier,
        expires_at: base.toISOString(),
        updated_at: new Date().toISOString(),
      });

      await admin
        .from("payment_submissions")
        .update({ status: "approved", auto_approved: true, reviewed_at: new Date().toISOString() })
        .eq("id", submission_id);
    }

    // Send the admin the receipt itself, with buttons that still work
    // either way: Approve is a confirmation when already granted, and
    // Reject revokes through the same telegram-admin-bot handler.
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
    if (botToken && adminChatId) {
      const caption =
        `🧾 វិក្កយបត្រពីអ្នកប្រើ${AUTO_GRANT_ON_PROOF ? " — VIP បានដោះសោជាបណ្ដោះអាសន្ន" : ""}\n\n` +
        `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
        `🆔 ${sub.telegram_user_id}\n` +
        `📦 ${sub.tier}\n` +
        `💵 $${sub.amount}\n\n` +
        `សូមផ្ទៀងផ្ទាត់ជាមួយបញ្ជីធនាគារ រួចចុច ✅ ដើម្បីបញ្ជាក់ ឬ ❌ ដើម្បីដកវិញ`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: adminChatId,
          photo: screenshot_url,
          caption,
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Confirm", callback_data: `pay_approve:${submission_id}` },
              { text: "❌ Revoke", callback_data: `pay_reject:${submission_id}` },
            ]],
          },
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, granted: AUTO_GRANT_ON_PROOF }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
