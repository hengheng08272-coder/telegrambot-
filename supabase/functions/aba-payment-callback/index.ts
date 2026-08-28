import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// =====================================================================
// Receives ABA PayWay's server-to-server pushback after a payment made
// through aba-create-transaction, and grants VIP automatically once
// it's confirmed — this is the REAL automatic confirmation (server
// verified against ABA itself), replacing the old "guess from a
// forwarded Telegram notification" approach for any payment made
// through the gateway.
//
// SECURITY: never trust the callback body's own "success" claim by
// itself — anyone who finds this URL could POST a fake one. Instead,
// as soon as a callback arrives for a tran_id, we call ABA's own Check
// Transaction API with our merchant credentials to ask ABA directly
// "is this transaction actually paid?" and only grant VIP if ABA's
// answer is yes.
//
// SETUP:
//   1. Same secrets as aba-create-transaction: ABA_PAYWAY_MERCHANT_ID,
//      ABA_PAYWAY_API_KEY, ABA_PAYWAY_ENV.
//   2. Ask ABA's integration team to whitelist this exact URL as an
//      allowed callback/return URL for your merchant profile:
//        https://<your-project-ref>.supabase.co/functions/v1/aba-payment-callback
//   3. Test a real small sandbox payment end-to-end before relying on
//      this in production — confirm this function's logs show
//      PAID/APPROVED and that the viewer's VIP actually unlocks.
// =====================================================================

const corsHeaders = {  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// TELEGRAM_ADMIN_CHAT_ID may hold more than one id, separated by commas or
// spaces ("111111,7777639689") — every id listed gets the same admin
// notifications, and a single id keeps behaving exactly as before.
function adminChatIds(): string[] {
  return (Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function baseUrl(env: string) {
  return env === "production"
    ? "https://checkout.payway.com.kh"
    : "https://checkout-sandbox.payway.com.kh";
}

function reqTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

async function hmacSha512Base64(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// Fallback only — live source of truth is pricing_tiers.months (Admin
// Panel -> Subscriptions -> "Duration").
const TIER_MONTHS_FALLBACK: Record<string, number> = {
  "1m": 1,
  "2m": 2,
  "6m": 6,
  "12m": 12,
};

async function tg(token: string, adminChatId: string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: adminChatId, text }),
    });
  } catch {
    // Best-effort only — never let a notify failure block confirmation.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  // Always ack fast — ABA (like Telegram) will retry a non-200 forever.
  const ack = () => new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return ack();

  const merchantId = Deno.env.get("ABA_PAYWAY_MERCHANT_ID");
  const apiKey = Deno.env.get("ABA_PAYWAY_API_KEY");
  const env = Deno.env.get("ABA_PAYWAY_ENV") || "sandbox";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!merchantId || !apiKey) {
    console.error("aba-payment-callback: gateway secrets not configured");
    return ack();
  }

  let payload: any;
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else {
      const form = await req.formData();
      payload = Object.fromEntries(form.entries());
    }
  } catch {
    return ack();
  }

  const tranId: string | undefined = payload?.tran_id;
  if (!tranId) {
    console.log("[aba-payment-callback] no tran_id in payload:", payload);
    return ack();
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: sub } = await admin
      .from("payment_submissions")
      .select("*")
      .eq("aba_tran_id", tranId)
      .maybeSingle();

    if (!sub) {
      console.log(`[aba-payment-callback] no submission for tran_id ${tranId}`);
      return ack();
    }
    if (sub.status !== "pending") {
      console.log(`[aba-payment-callback] ${tranId} already handled (${sub.status})`);
      return ack();
    }

    // ---- Re-verify with ABA directly — do not trust the pushback alone ----
    const rt = reqTime();
    const checkHashInput = rt + merchantId + tranId;
    const checkHash = await hmacSha512Base64(checkHashInput, apiKey);

    const checkRes = await fetch(`${baseUrl(env)}/api/payment-gateway/v1/payments/check-transaction-2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ req_time: rt, merchant_id: merchantId, tran_id: tranId, hash: checkHash }),
    });
    const checkJson = await checkRes.json().catch(() => null);
    const paymentStatus: string | undefined = checkJson?.data?.payment_status;

    console.log(`[aba-payment-callback] check-transaction for ${tranId}:`, paymentStatus, checkJson?.status);

    if (paymentStatus !== "APPROVED") {
      // Not actually paid yet (or declined/pending/expired) — do
      // nothing. If it becomes APPROVED later, ABA will call back
      // again, or the existing 30s client-side auto-approve / admin
      // manual review still cover it.
      return ack();
    }

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

    const { data: updated } = await admin
      .from("payment_submissions")
      .update({ status: "approved", auto_approved: true, reviewed_at: new Date().toISOString() })
      .eq("id", sub.id)
      .eq("status", "pending") // guard against a race with the client's own 30s auto-approve
      .select("id")
      .maybeSingle();

    if (!updated) {
      console.log(`[aba-payment-callback] ${tranId} was approved by another path first — no-op`);
      return ack();
    }

    console.log(`[aba-payment-callback] VIP granted via real ABA gateway: ${sub.id} (${sub.tier}, $${sub.amount})`);

    const mainBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    for (const chatId of mainBotToken ? adminChatIds() : []) {
      await tg(
        mainBotToken!,
        chatId,
        `✅ ទូទាត់ស្វ័យប្រវត្តិ — ផ្ទៀងផ្ទាត់ពិតតាម ABA PayWay Gateway\n` +
          `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
          `📦 ${sub.tier} — $${sub.amount}\n` +
          `🔖 tran_id: ${tranId}`,
      );
    }

    return ack();
  } catch (err) {
    console.error("aba-payment-callback error:", err);
    return ack();
  }
});
