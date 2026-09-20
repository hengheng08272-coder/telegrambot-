import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Standalone $1 movie purchases — completely separate from VIP. Called
// from MoviePurchaseModal (lib/moviePurchase.ts attachMovieScreenshot)
// right after the viewer attaches a receipt photo. Mirrors
// confirm-payment-proof's optimistic-grant tradeoff (unlock now, admin
// reviews the photo afterward with Confirm/Revoke) but writes only to
// movie_purchases — this function never touches subscriptions, so it
// cannot accidentally grant or extend VIP time.
//
// Required secrets (same ones already set for the VIP flow):
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_ADMIN_CHAT_ID

const AUTO_GRANT_ON_PROOF = true;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
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
      .from("movie_purchases")
      .select("*")
      .eq("id", submission_id)
      .maybeSingle();

    if (!sub) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("movie_purchases").update({ screenshot_url }).eq("id", submission_id);

    if (sub.status !== "pending") {
      return new Response(JSON.stringify({ ok: true, alreadyHandled: true, status: sub.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (AUTO_GRANT_ON_PROOF) {
      await admin
        .from("movie_purchases")
        .update({ status: "approved", auto_approved: true, reviewed_at: new Date().toISOString() })
        .eq("id", submission_id);
    }

    const { data: show } = await admin.from("shows").select("title").eq("id", sub.show_id).maybeSingle();

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    // Everyone who should see a film sell. admin_users is the source of
    // truth, so adding an administrator there puts them on these
    // notifications with no second place to remember; the env var is
    // merged in rather than replaced, because a group chat -- or a
    // recipient who is not an administrator -- still has to work.
    const chatIds = new Set<string>();
    for (const raw of (Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") ?? "").split(/[,\s]+/)) {
      const id = raw.trim();
      if (id) chatIds.add(id);
    }
    try {
      const { data: admins } = await admin.from("admin_users").select("telegram_user_id");
      for (const row of admins ?? []) {
        const id = String(row?.telegram_user_id ?? "").trim();
        if (id) chatIds.add(id);
      }
    } catch {
      // Table unreachable: env-configured recipients still get it.
    }
    if (botToken && chatIds.size > 0) {
      const caption =
        `🎬 ការទិញរឿង${AUTO_GRANT_ON_PROOF ? " — បានដោះសោបណ្ដោះអាសន្ន" : ""}\n\n` +
        `👤 ${sub.telegram_username ? "@" + sub.telegram_username : sub.telegram_user_id}\n` +
        `🆔 ${sub.telegram_user_id}\n` +
        `📀 ${show?.title ?? sub.show_id}\n` +
        `💵 $${sub.amount}\n\n` +
        `សូមផ្ទៀងផ្ទាត់ជាមួយបញ្ជីធនាគារ រួចចុច ✅ ដើម្បីបញ្ជាក់ ឬ ❌ ដើម្បីដកវិញ`;

      // Sent to each in parallel, each swallowing its own failure: an
      // admin who has never pressed Start on the bot answers 403, and
      // that must not stop the others being told.
      await Promise.all(
        [...chatIds].map((chatId) =>
          fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              photo: screenshot_url,
              caption,
              reply_markup: {
                inline_keyboard: [[
                  { text: "✅ Confirm", callback_data: `movie_confirm:${submission_id}` },
                  { text: "❌ Revoke", callback_data: `movie_revoke:${submission_id}` },
                ]],
              },
            }),
          }).catch(() => {}),
        ),
      );
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
