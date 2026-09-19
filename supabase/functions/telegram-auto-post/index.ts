import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Auto-posts a rotating selection of shows into the VIP Telegram group —
// poster + title + synopsis + current episode + a "watch now" button that
// deep-links into the Mini App. Meant to be hit by a pg_cron job every
// minute (see database/telegram-auto-post-addition.sql and
// TELEGRAM_AUTO_POST_SETUP_KH.md); the function itself decides whether
// enough time has actually passed since the last run, so the cron
// schedule never needs to change when the admin edits the interval from
// the Admin Panel.
//
// Required secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   TELEGRAM_BOT_TOKEN     - from @BotFather
//   TELEGRAM_GROUP_ID      - the VIP group's chat id (negative number)
//   TELEGRAM_MINIAPP_URL   - e.g. https://t.me/AnimetioMini_bot/App
//                            (no query string)
// Optional:
//   TELEGRAM_BOT_USERNAME     - defaults to the handle inside MINIAPP_URL
//   TELEGRAM_SUPPORT_USERNAME - the human to contact, default NintPlexminiapp

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface Show {
  id: string;
  title: string;
  synopsis: string | null;
  poster_url: string | null;
  type: "series" | "movie";
  status: string | null;
  is_free?: boolean;
}

async function tg(botToken: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram API ${method} failed:`, JSON.stringify(data));
  }
  return data;
}

// Telegram caps a photo caption at 1024 characters. The synopsis is the
// only field with no natural bound, so it's the one that gets trimmed —
// everything else (title, episode line, link) stays intact.
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    const groupId = Deno.env.get("TELEGRAM_GROUP_ID")!;
    // Normalised before anything is built on it. Telegram resolves a
    // Mini App link by exact path, and two harmless-looking things in a
    // pasted value stop it dead: a trailing slash
    // (t.me/Bot/App/?startapp=… resolves to nothing) and a query string
    // already on the end (…?x=1?startapp=… is not a URL). Both produce
    // the bot's plain profile page with a START BOT button instead of
    // the app, which looks like the link is wrong when the setting is.
    const miniAppUrl = (Deno.env.get("TELEGRAM_MINIAPP_URL") ?? "")
      .trim()
      .split("?")[0]
      .replace(/\/+$/, "");
    // Read from the Mini App URL rather than configured twice, so the
    // handle in the caption can never drift from the link beside it.
    // https://t.me/AnimetioMini_bot/App -> AnimetioMini_bot
    const botUsername =
      (Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "").trim().replace(/^@/, "") ||
      miniAppUrl.match(/t\.me\/([A-Za-z0-9_]+)/)?.[1] ||
      "AnimetioMini_bot";
    // A person, not the bot: where a viewer goes when a payment needs a
    // human. Same account the app's own support button opens.
    const supportUsername =
      (Deno.env.get("TELEGRAM_SUPPORT_USERNAME") ?? "").trim().replace(/^@/, "") ||
      "NintPlexminiapp";
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // `force: true` skips the interval check — used by the Admin Panel's
    // "Post now" test button. The cron tick calls this with no body (or
    // an empty one), so it always goes through the interval check.
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch {
      // no/invalid JSON body — fine, means a plain cron tick.
    }

    const { data: settings, error: settingsErr } = await admin
      .from("telegram_auto_post_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (settingsErr || !settings) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_settings_row" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!settings.enabled) {
      return new Response(JSON.stringify({ ok: true, skipped: "disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!force && settings.last_run_at) {
      const dueAt = new Date(settings.last_run_at).getTime() + settings.interval_minutes * 60_000;
      if (Date.now() < dueAt) {
        return new Response(
          JSON.stringify({ ok: true, skipped: "not_due", due_at: new Date(dueAt).toISOString() }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Every non-"coming soon" show is eligible — movies and series alike.
    const { data: shows, error: showsErr } = await admin
      .from("shows")
      .select("id, title, synopsis, poster_url, type, status, is_free")
      .eq("coming_soon", false);

    if (showsErr || !shows || shows.length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_shows" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Last time each show was auto-posted, so the picker can favour
    // whichever ones haven't had a turn in the longest time (or ever).
    const { data: logRows } = await admin
      .from("telegram_auto_post_log")
      .select("show_id, posted_at")
      .order("posted_at", { ascending: false });

    const lastPosted = new Map<string, number>();
    for (const row of logRows ?? []) {
      if (!lastPosted.has(row.show_id)) lastPosted.set(row.show_id, new Date(row.posted_at).getTime());
    }

    const ranked = (shows as Show[])
      .slice()
      .sort((a, b) => (lastPosted.get(a.id) ?? 0) - (lastPosted.get(b.id) ?? 0));

    const batch = ranked.slice(0, Math.max(1, settings.shows_per_run));

    const posted: string[] = [];
    for (const show of batch) {
      // Two facts on one line, separated rather than nested: how far the
      // series has got, and whether it is still going. They used to be
      // glued together as "កំពុងចាក់ដល់ភាគទី 188 (កំពុងចាក់)" — the same
      // word twice in one breath, because the episode phrase already
      // carried the status the bracket then repeated.
      let episodeLine = "";
      if (show.type === "movie") {
        episodeLine = "🎬 ភាពយន្តពេញមួយ";
      } else {
        const { data: latestEp } = await admin
          .from("episodes")
          .select("episode_number")
          .eq("show_id", show.id)
          .order("episode_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        episodeLine = latestEp
          ? `📺 ភាគទី ${latestEp.episode_number}`
          : "📺 ភាគថ្មីៗបន្ថែមឡើងឥតឈប់";

        if (show.status === "completed") {
          episodeLine += "  ·  ✅ ចប់ហើយ";
        } else if (show.status === "ongoing") {
          episodeLine += "  ·  🔴 កំពុងចាក់";
        } else if (show.status) {
          episodeLine += `  ·  ${show.status}`;
        }
      }
      if (show.is_free) {
        episodeLine += "  ·  🎁 ឥតគិតថ្លៃ";
      }

      const deepLink = `${miniAppUrl}?startapp=show_${show.id}`;
      const synopsis = show.synopsis ? truncate(show.synopsis, 500) : "";

      // The handles go in the TEXT as well as on the buttons, and that is
      // deliberate. Inline buttons do not survive a forward: the post
      // that spreads furthest is the one somebody passes to a friend, and
      // it arrives with the buttons stripped. A line of @handles is the
      // part that still works in a screenshot.
      //
      // One handle per line, not two either side of a dot. A Khmer word
      // between two @handles is wide, and Telegram wrapped the pair
      // mid-address on a phone — which reads as a broken link even
      // though it is not one. A line each cannot wrap.
      const contactLines = [
        `🤖 Bot · @${botUsername}`,
        `💬 ជំនួយ · @${supportUsername}`,
      ].join("\n");

      const captionParts = [
        `🎬 <b>${show.title}</b>`,
        synopsis,
        episodeLine,
        contactLines,
      ].filter(Boolean);
      const caption = truncate(captionParts.join("\n\n"), 1024);

      // One button per row, each one a different decision: watch THIS,
      // subscribe, or ask a person. Side by side they wrapped to
      // unreadable stubs in Khmer, and stacking them also puts the
      // membership button — the one that earns anything — on a line of
      // its own where it cannot be missed.
      //
      // There is no "open the Mini App" button any more. It landed on the
      // home screen, which is where somebody already is once any of the
      // other two buttons has taken them in; the post was spending a row
      // on the least useful destination it had.
      const replyMarkup = {
        inline_keyboard: [
          [{ text: "▶️  ចូលទស្សនា", url: deepLink }],
          [{ text: "👑  ចូលជាសមាជិក VIP", url: `${miniAppUrl}?startapp=vip` }],
          [{ text: "💬  ជំនួយ", url: `https://t.me/${supportUsername}` }],
        ],
      };

      const sendResult = show.poster_url
        ? await tg(botToken, "sendPhoto", {
            chat_id: groupId,
            photo: show.poster_url,
            caption,
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          })
        : await tg(botToken, "sendMessage", {
            chat_id: groupId,
            text: caption,
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          });

      if (sendResult.ok) {
        await admin.from("telegram_auto_post_log").insert({ show_id: show.id });
        posted.push(show.id);
      }
    }

    await admin
      .from("telegram_auto_post_settings")
      .update({ last_run_at: new Date().toISOString() })
      .eq("id", 1);

    return new Response(JSON.stringify({ ok: true, posted }), {
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
