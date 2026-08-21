import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// =====================================================================
// Asks ABA PayWay to issue the KHQR for one payment ticket.
//
// src/lib/subscription.ts has called this function since the gateway
// work started, but it was never written — the invoke failed, the caller
// read `configured: false`, and the app fell back to the static QR
// without ever saying why. So "pay now" has never once run.
//
// It matters more than a missing convenience. Every attempt to BUILD a
// KHQR for ABA outside ABA gets refused at payment time with "Invalid Qr
// Merchant Data", because ABA's own payloads carry a proprietary tag 40
// holding a per-account reference nothing outside ABA can know. A QR ABA
// issued itself has no such problem, and it arrives under the merchant
// name registered to the account — which is the whole reason for
// generating QRs here rather than reusing an uploaded picture.
//
// It also removes the need for an NBC Bakong developer token: payments
// made this way are confirmed by aba-payment-callback, which re-checks
// each one against ABA's own Check Transaction API before granting VIP.
//
// Required secrets:
//   ABA_PAYWAY_MERCHANT_ID, ABA_PAYWAY_API_KEY
//   ABA_PAYWAY_ENV  -- "sandbox" (default) or "production"
//
// Until those are set this returns { configured: false } and the app
// carries on with the QR flow exactly as before.
// =====================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function baseUrl(env: string): string {
  return env === "production"
    ? "https://checkout.payway.com.kh"
    : "https://checkout-sandbox.payway.com.kh";
}

/** PayWay wants req_time as YYYYMMDDHHmmss in UTC. */
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

/** How long ABA keeps the QR payable, in minutes. */
const LIFETIME_MINUTES = 5;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const { submission_id, debug } = await req.json();
    if (!submission_id) return json({ configured: false, error: "missing submission_id" }, 400);

    const merchantId = Deno.env.get("ABA_PAYWAY_MERCHANT_ID");
    const apiKey = Deno.env.get("ABA_PAYWAY_API_KEY");
    const env = Deno.env.get("ABA_PAYWAY_ENV") || "sandbox";
    // Not an error — this is the "gateway not set up yet" path the
    // caller is built to handle, and the QR flow covers it.
    if (!merchantId || !apiKey) return json({ configured: false });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: sub } = await admin
      .from("payment_submissions")
      .select("*")
      .eq("id", submission_id)
      .maybeSingle();
    if (!sub) return json({ configured: true, error: "submission not found" }, 404);
    if (sub.status !== "pending") {
      return json({ configured: true, error: `submission already ${sub.status}` }, 409);
    }

    // Reuse the transaction already issued for this ticket rather than
    // opening a second one. A ticket that produced two tran_ids would
    // leave one of them payable but unmatched by the callback, which
    // looks to the payer like money that vanished.
    if (sub.aba_tran_id && sub.aba_qr_string) {
      return json({
        configured: true,
        tranId: sub.aba_tran_id,
        qrString: sub.aba_qr_string,
        deeplink: sub.aba_deeplink ?? null,
        checkoutUrl: null,
      });
    }

    // tran_id is capped at 20 characters and has to be unique per
    // transaction. The ticket's own id is the natural key; the time
    // suffix keeps a retried ticket from colliding with its first try.
    const tranId = `${String(sub.id).replace(/-/g, "").slice(0, 10)}${Date.now().toString().slice(-8)}`;

    const rt = reqTime();
    // Sent as a string and hashed as the same string. PayWay hashes the
    // literal value it receives, so a number formatted one way in the
    // body and another in the hash is an "invalid hash" with nothing
    // else to go on.
    const amount = Number(sub.amount).toFixed(2);
    const currency = "USD";
    const paymentOption = "abapay_khqr";
    const purchaseType = "purchase";
    const callbackUrl = btoa(`${supabaseUrl}/functions/v1/aba-payment-callback`);
    const lifetime = String(LIFETIME_MINUTES);

    // Field order is PayWay's, taken from the QR API's own hash spec:
    //   req_time, merchant_id, tran_id, amount, items, first_name,
    //   last_name, email, phone, purchase_type, payment_option,
    //   callback_url, return_deeplink, currency, custom_fields,
    //   return_params, payout, lifetime, qr_image_template
    // Fields this app does not send still take part, as empty strings —
    // dropping one shifts everything after it and the hash no longer
    // matches. Written out one per line, with the empties named, so a
    // future edit cannot quietly lose one.
    const items = "";
    const firstName = "";
    const lastName = "";
    const email = "";
    const phone = "";
    const returnDeeplink = "";
    const customFields = "";
    const returnParams = "";
    const payout = "";
    const qrImageTemplate = "";

    const hashSource =
      rt +
      merchantId +
      tranId +
      amount +
      items +
      firstName +
      lastName +
      email +
      phone +
      purchaseType +
      paymentOption +
      callbackUrl +
      returnDeeplink +
      currency +
      customFields +
      returnParams +
      payout +
      lifetime +
      qrImageTemplate;

    const hash = await hmacSha512Base64(hashSource, apiKey);

    const body = {
      req_time: rt,
      merchant_id: merchantId,
      tran_id: tranId,
      amount,
      purchase_type: purchaseType,
      payment_option: paymentOption,
      callback_url: callbackUrl,
      currency,
      lifetime,
      hash,
    };

    const resp = await fetch(`${baseUrl(env)}/api/payment-gateway/v1/payments/generate-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
    const result = await resp.json().catch(() => null);

    // "invalid hash" is the one failure that cannot be diagnosed from
    // the outside, so debug returns the exact string that was hashed
    // (never the key) to compare against PayWay's own sample.
    const debugInfo = debug ? { hashSource, sent: { ...body, hash: "<redacted>" }, raw: result } : undefined;

    const code = String(result?.status?.code ?? "");
    // PayWay signals success with "0" on this endpoint and "00" on some
    // others; accept either rather than guess which one this deploy
    // returns.
    if (!result || (code !== "0" && code !== "00")) {
      console.error("[aba-create-transaction] generate-qr failed:", resp.status, result?.status);
      return json({
        configured: true,
        error: result?.status?.message ?? `generate-qr HTTP ${resp.status}`,
        code: code || null,
        debug: debugInfo,
      });
    }

    const qrString: string | null = result?.qrString ?? null;
    const deeplink: string | null = result?.abapay_deeplink ?? null;

    // Recorded before the QR is handed over, because aba-payment-callback
    // finds the ticket by aba_tran_id — a QR paid before that column is
    // written is a payment the callback cannot match to anybody.
    const { error: saveErr } = await admin
      .from("payment_submissions")
      .update({
        aba_tran_id: tranId,
        aba_qr_string: qrString,
        aba_deeplink: deeplink,
        payment_method: "aba_gateway",
      })
      .eq("id", submission_id);
    if (saveErr) {
      console.error("[aba-create-transaction] could not store tran_id:", saveErr.message);
      return json({ configured: true, error: "could not record transaction", debug: debugInfo });
    }

    return json({
      configured: true,
      tranId,
      qrString,
      deeplink,
      checkoutUrl: null,
      debug: debugInfo,
    });
  } catch (err) {
    return json({ configured: false, error: String(err) }, 500);
  }
});
