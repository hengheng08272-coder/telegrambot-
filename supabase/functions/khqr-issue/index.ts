import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { applyKhqrTemplate, readKhqrField } from "../_shared/khqr.ts";
import { md5 } from "../_shared/md5.ts";

// =====================================================================
// The QR API — issue the KHQR for one payment ticket, server side.
//
// Until now every KHQR was built in the member's own browser
// (src/lib/bakong.ts). That works, and it stays as the fallback, but it
// puts three things in the wrong place:
//
//   1. THE AMOUNT. The browser decided whether the QR carried $2 or $28.
//      Here the price is read back from pricing_tiers by the ticket's own
//      tier, so what the QR asks for is what the owner set, not what the
//      client claimed.
//
//   2. ONE QR PER TICKET. The payload is issued once and stored on the
//      ticket. A re-render, a reconnect, or a second tab gets the same
//      payload and therefore the same md5 — and md5 is the handle
//      Bakong's check_transaction_by_md5 answers about, so a ticket that
//      quietly changed its md5 is a payment nothing can confirm.
//
//   3. ONE CODE PATH. The admin panel's preview and a member's real
//      payment now call the same function, so a preview that looks right
//      is evidence the real thing is right.
//
// Not configured is not an error: with no pasted template the answer is
// `{ configured: false }` and the caller falls back to the uploaded QR
// image, exactly as before.
//
// ---------------------------------------------------------------------
// WHY THIS IS SAFE TO CALL WITHOUT AUTH
//
// Everything it returns is already public to anyone who can open the
// subscribe screen: the payee's KHQR is shown to every member who picks
// a plan, and the settings it is built from live in app_settings, which
// is world-readable so the browser fallback can work. A stranger calling
// this with a guessed ticket id learns the amount of that ticket and
// gets a QR that pays the owner — neither of which is a capability they
// did not already have.
//
// What it deliberately does NOT do is trust the caller. The amount comes
// from the database, never the request body, on any path that touches a
// real ticket; only `preview` accepts an amount, and preview writes
// nothing.
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

/** The ticket window in SubscriptionModal — the QR should not outlive it. */
const WAIT_WINDOW_MS = 3 * 60 * 1000;

const SETTING_KEYS = {
  merchantName: "bakong_merchant_name",
  khqrTemplate: "bakong_khqr_template",
  billNumberEnabled: "bakong_bill_number_enabled",
} as const;

/** Ticket id squeezed into the 25 characters tag 62 allows. */
function billNumberFor(submissionId: string): string {
  return String(submissionId).replace(/-/g, "").slice(0, 25);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { submission_id, preview } = body as { submission_id?: string; preview?: boolean };
    if (!preview && !submission_id) {
      return json({ configured: false, error: "missing submission_id" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settingRows } = await admin
      .from("app_settings")
      .select("key, value")
      .in("key", Object.values(SETTING_KEYS));
    const settings = new Map((settingRows ?? []).map((r) => [r.key as string, r.value as string]));

    const template = (settings.get(SETTING_KEYS.khqrTemplate) ?? "").trim();
    // The "owner never pasted a KHQR" path. Not an error — the uploaded
    // QR image flow covers it, and always has.
    if (!template) return json({ configured: false });

    const merchantName = (settings.get(SETTING_KEYS.merchantName) ?? "").trim();
    // Off unless explicitly turned on: writing tag 62 adds a field to a
    // payload the bank accepted as it was, and only a real payment can
    // prove it still accepts it. See TemplateOverrides.billNumber.
    const billNumberEnabled = (settings.get(SETTING_KEYS.billNumberEnabled) ?? "").trim() === "true";

    // ---- preview: build one and throw it away ------------------------
    if (preview) {
      const amount = Number((body as { amount?: number }).amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return json({ configured: true, error: "bad-amount" }, 400);
      }
      const built = applyKhqrTemplate(template, {
        amount,
        merchantName: merchantName || null,
        // A fixed stand-in, so a preview shows the shape a real ticket
        // gets without inventing an id that looks like one.
        billNumber: billNumberEnabled ? "PREVIEW" : null,
      });
      if (!built.ok) return json({ configured: true, error: built.reason });
      return json({
        configured: true,
        payload: built.payload,
        md5: md5(built.payload),
        payeeName: readKhqrField(built.payload, "59"),
        amount,
        expiresAt: new Date(Date.now() + WAIT_WINDOW_MS).toISOString(),
        preview: true,
      });
    }

    // ---- a real ticket -----------------------------------------------
    const { data: sub } = await admin
      .from("payment_submissions")
      .select("*")
      .eq("id", submission_id)
      .maybeSingle();
    if (!sub) return json({ configured: true, error: "submission not found" }, 404);
    if (sub.status !== "pending") {
      return json({ configured: true, error: `submission already ${sub.status}` }, 409);
    }

    const expiresAt = new Date(
      new Date(sub.submitted_at ?? Date.now()).getTime() + WAIT_WINDOW_MS,
    ).toISOString();

    // PayWay owns this ticket. aba-create-transaction writes aba_tran_id
    // and aba_qr_string together, so a tran_id means there is a real ABA
    // transaction open against that exact payload — rebuilding over it
    // would leave the transaction payable but pointing at a QR nobody is
    // showing any more. Hand back what PayWay issued and write nothing.
    if (sub.aba_tran_id && sub.aba_qr_string) {
      return json({
        configured: true,
        payload: sub.aba_qr_string,
        md5: md5(sub.aba_qr_string),
        payeeName: readKhqrField(sub.aba_qr_string, "59"),
        amount: Number(readKhqrField(sub.aba_qr_string, "54") ?? sub.amount),
        expiresAt,
        gateway: "payway",
      });
    }

    // Already issued by this function: hand back the same payload rather
    // than minting a second one. Checked by recomputing the md5 rather
    // than trusting the column, so a payload some other path wrote into
    // aba_qr_string is not mistaken for one of ours.
    if (sub.aba_qr_string && sub.khqr_md5 && md5(sub.aba_qr_string) === sub.khqr_md5) {
      return json({
        configured: true,
        payload: sub.aba_qr_string,
        md5: sub.khqr_md5,
        payeeName: readKhqrField(sub.aba_qr_string, "59"),
        amount: Number(readKhqrField(sub.aba_qr_string, "54") ?? sub.amount),
        expiresAt,
        reissued: true,
      });
    }

    // The price the owner set, not the one the client sent. Falls back to
    // the ticket's own amount when pricing_tiers has no row for the tier
    // — older deploys seed prices in code (src/lib/subscription.ts), and
    // a missing row must not stop somebody paying.
    const { data: tierRow } = await admin
      .from("pricing_tiers")
      .select("price")
      .eq("key", sub.tier)
      .maybeSingle();
    const amount = Number(tierRow?.price ?? sub.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ configured: true, error: "bad-amount" }, 400);
    }

    const built = applyKhqrTemplate(template, {
      amount,
      merchantName: merchantName || null,
      billNumber: billNumberEnabled ? billNumberFor(sub.id) : null,
    });
    if (!built.ok) return json({ configured: true, error: built.reason });

    const payloadMd5 = md5(built.payload);
    // Written here rather than by the client because RLS (correctly)
    // does not let a viewer update this table at all. khqr_md5 is what
    // bakong-verify later asks the bank about; aba_qr_string is the
    // payload itself, so an admin looking at a disputed ticket can see
    // exactly what was scanned.
    await admin
      .from("payment_submissions")
      .update({ aba_qr_string: built.payload, khqr_md5: payloadMd5 })
      .eq("id", sub.id)
      .eq("status", "pending");

    return json({
      configured: true,
      payload: built.payload,
      md5: payloadMd5,
      payeeName: readKhqrField(built.payload, "59"),
      amount,
      expiresAt,
    });
  } catch (err) {
    return json({ configured: false, error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});
