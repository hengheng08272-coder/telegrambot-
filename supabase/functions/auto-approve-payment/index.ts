import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Called by the client (SubscriptionModal) once its 30-second countdown
// runs out with no admin decision yet. Grants VIP immediately so the
// viewer isn't stuck waiting, but flags the submission (auto_approved) so
// it still surfaces in the Admin Panel's "Needs confirmation" queue for a
// real human look afterward — this is optimistic trust, not a skipped
// review. If the admin already approved/rejected in the meantime, this
// is a safe no-op (checks status === 'pending' first).
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_BOT_TOKEN     - same bot used elsewhere
//   TELEGRAM_ADMIN_CHAT_ID - your personal Telegram chat id

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const TIER_MONTHS: Record<string, number> = {
  "1m": 1,
  "2m": 1,
  "6m": 6,
  "12m": 12,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { submission_id } = await req.json();
    if (!submission_id) {
      return new Response(JSON.stringify({ error: "missing submission_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

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

    // Already handled (admin was faster than the 30s window, or this
    // somehow got called twice) — no-op, not an error.
    if (sub.status !== "pending") {
      return new Response(JSON.stringify({ ok: true, alreadyHandled: true, status: sub.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing } = await admin
      .from("subscriptions")
      .select("expires_at")
      .eq("telegram_user_id", sub.telegram_user_id)
      .maybeSingle();

    const base =
      existing?.expires_at && new Date(existing.expires_at) > new Date()
        ? new Date(existing.expires_at)
        : new Date();
    base.setMonth(base.getMonth() + (TIER_MONTHS[sub.tier] ?? 1));

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

    // Let the admin know this one went through without them, so they
    // remember to check it in the Payments panel.
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
    if (botToken && adminChatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: adminChatId,
          text:
            `⏱️ Auto-approved (no response within 30s)\n` +
            `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
            `📦 ${sub.tier} — $${sub.amount}\n\n` +
            `សូមចូល Admin Panel → Payments → "Needs confirmation" ដើម្បីត្រួតពិនិត្យឡើងវិញ`,
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
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
