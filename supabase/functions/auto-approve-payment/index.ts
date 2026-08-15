import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Grants VIP immediately (optimistic approval), then flags the
// submission (auto_approved=true, admin_confirmed=false) so it still
// surfaces in Admin Panel -> Payments -> "Waitlist" for a real human
// look afterward -- admin can Confirm (keeps VIP) or Revoke (removes it)
// from there. Called by attachScreenshotToSubmission right after a
// viewer attaches a receipt screenshot to a pending submission. Safe
// no-op if the submission was already approved/rejected by then.
//
// Required secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fallback only -- live source of truth is pricing_tiers.months, editable
// from Admin Panel -> Subscriptions -> "Duration".
const TIER_MONTHS_FALLBACK: Record<string, number> = { "1m": 1, "2m": 2, "6m": 6, "12m": 12 };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { submission_id } = await req.json();
    if (!submission_id) {
      return new Response(JSON.stringify({ error: "missing submission_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: sub } = await admin.from("payment_submissions").select("*").eq("id", submission_id).maybeSingle();

    if (!sub) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (sub.status !== "pending") {
      return new Response(JSON.stringify({ ok: true, alreadyHandled: true, status: sub.status }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: tierRow } = await admin.from("pricing_tiers").select("months").eq("key", sub.tier).maybeSingle();
    const months = tierRow?.months ?? TIER_MONTHS_FALLBACK[sub.tier] ?? 1;

    const { data: existing } = await admin.from("subscriptions").select("expires_at").eq("telegram_user_id", sub.telegram_user_id).maybeSingle();

    const base = existing?.expires_at && new Date(existing.expires_at) > new Date() ? new Date(existing.expires_at) : new Date();
    base.setMonth(base.getMonth() + months);

    await admin.from("subscriptions").upsert({
      telegram_user_id: sub.telegram_user_id,
      telegram_username: sub.telegram_username,
      tier: sub.tier,
      expires_at: base.toISOString(),
      updated_at: new Date().toISOString(),
    });

    await admin.from("payment_submissions").update({ status: "approved", auto_approved: true, reviewed_at: new Date().toISOString() }).eq("id", submission_id);

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const adminChatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
    if (botToken && adminChatId) {
      const caption =
        "⚡ ការទូទាត់បានឆ្លងកាត់ការផ្ទៀងផ្ទាត់ស្វ័យប្រវត្តិ\n\n" +
        `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
        `📦 ${sub.tier} — $${sub.amount}\n\n` +
        NEEDS_CONFIRMATION_NOTE;
      if (sub.screenshot_url) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: adminChatId, photo: sub.screenshot_url, caption }),
        });
      } else {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: adminChatId, text: caption }),
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

const NEEDS_CONFIRMATION_NOTE =
  "សូមចូល Admin Panel → Payments → “Waitlist” ដើម្បីបញ្ជាក់";
