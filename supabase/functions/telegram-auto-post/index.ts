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
  created_at?: string | null;
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
  return data as { ok: boolean; description?: string };
}

// Captions are sent with parse_mode HTML, so any of &, < or > coming out
// of a title or synopsis has to be escaped — Telegram rejects the whole
// message with "can't parse entities" otherwise, and a single show titled
// e.g. "Fate & Zero" would silently never post.
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Telegram caps a photo caption at 1024 characters. The synopsis is the
// only field with no natural bound, so it's the one that gets trimmed —
// everything else (title, episode line, link) stays intact.
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

// Trimming already-escaped text can cut through an entity ("&amp;" ->
// "&am"), which Telegram rejects just as it rejects a bare "&", so any
// dangling one is dropped after the cut.
function truncateEscaped(text: string, max: number): string {
  return truncate(text, max).replace(/&[a-z]{0,5}(…)?$/i, (_match, ellipsis) => ellipsis ?? "");
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
    const miniAppUrl = Deno.env.get("TELEGRAM_MINIAPP_URL")!;
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

    // A forced run is an admin pressing "Post now (test)", so it goes
    // through even while auto-posting is switched off — otherwise there is
    // no way to check the bot token, group id and caption before enabling.
    if (!settings.enabled && !force) {
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

    // Two ways to choose what goes out, set from the Admin Panel:
    //   rotate (default) — every non-"coming soon" show is eligible and
    //                      the least recently posted one goes first;
    //   queue            — only the shows the admin picked, walked in the
    //                      admin's own order, wrapping at the end. A
    //                      queued show posts even if it is marked coming
    //                      soon: putting it in the list is a deliberate
    //                      choice.
    const queueMode = settings.selection_mode === "queue";
    const SHOW_COLUMNS = "id, title, synopsis, poster_url, type, status, is_free, created_at";

    let queueOrder: string[] = [];
    let shows: Show[] | null = null;

    if (queueMode) {
      const { data: queueRows } = await admin
        .from("telegram_auto_post_queue")
        .select("show_id, position")
        .order("position", { ascending: true });
      queueOrder = (queueRows ?? []).map((row) => row.show_id as string);

      if (queueOrder.length === 0) {
        return new Response(JSON.stringify({ ok: true, skipped: "empty_queue" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data } = await admin.from("shows").select(SHOW_COLUMNS).in("id", queueOrder);
      shows = (data ?? []) as Show[];
    } else {
      const { data } = await admin.from("shows").select(SHOW_COLUMNS).eq("coming_soon", false);
      shows = (data ?? []) as Show[];
    }

    if (!shows || shows.length === 0) {
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

    const perRun = Math.max(1, settings.shows_per_run);
    let batch: Show[];

    if (queueMode) {
      // Walk the admin's list in their order. The starting point is
      // whatever comes after the most recently posted queue entry, so
      // each run continues where the last one stopped and the list loops
      // instead of always restarting from the top.
      const byId = new Map(shows.map((show) => [show.id, show]));
      const ordered = queueOrder.map((id) => byId.get(id)).filter((show): show is Show => !!show);

      let startAt = 0;
      let newestPost = -1;
      ordered.forEach((show, index) => {
        const posted = lastPosted.get(show.id);
        if (posted !== undefined && posted > newestPost) {
          newestPost = posted;
          startAt = (index + 1) % ordered.length;
        }
      });

      batch = [];
      for (let i = 0; i < Math.min(perRun, ordered.length); i++) {
        batch.push(ordered[(startAt + i) % ordered.length]);
      }
    } else {
      // Least-recently-posted first; never-posted shows (0) come first of
      // all. Shows that tie — every never-posted one, on the first run —
      // are ordered by age so a run of several shows is deterministic
      // instead of depending on whatever order PostgREST returned.
      batch = shows
        .slice()
        .sort((a, b) => {
          const diff = (lastPosted.get(a.id) ?? 0) - (lastPosted.get(b.id) ?? 0);
          if (diff !== 0) return diff;
          return new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime();
        })
        .slice(0, perRun);
    }

    const posted: string[] = [];
    const errors: string[] = [];
    for (const show of batch) {
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
          ? `📺 កំពុងចាក់ដល់ភាគទី ${latestEp.episode_number}`
          : "📺 ភាគថ្មីៗបន្ថែមឡើងឥតឈប់";
      }
      if (show.status) {
        const statusLabel = show.status === "completed" ? "ចប់ហើយ" : show.status === "ongoing" ? "កំពុងចាក់" : show.status;
        episodeLine += ` (${statusLabel})`;
      }

      const deepLink = `${miniAppUrl}?startapp=show_${show.id}`;
      const synopsis = show.synopsis ? escapeHtml(truncate(show.synopsis, 500)) : "";

      const captionParts = [
        `🎬 <b>${escapeHtml(show.title)}</b>`,
        synopsis,
        escapeHtml(episodeLine),
      ].filter(Boolean);
      const caption = truncateEscaped(captionParts.join("\n\n"), 1024);

      const replyMarkup = { inline_keyboard: [[{ text: "ចូលទស្សនា 📺", url: deepLink }]] };

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
      } else {
        // Passed back to the Admin Panel so a misconfigured bot token or
        // group id reads as "Bot is not a member of the group" instead of
        // a silent "Posted 0 show(s)".
        errors.push(`${show.title}: ${sendResult.description ?? "Telegram rejected the message"}`);
      }
    }

    // Only a scheduled run moves the clock. A forced test post used to
    // reset last_run_at too, which silently pushed the next real post a
    // full interval into the future every time the admin tested.
    let nextDueAt: string | null = null;
    if (!force) {
      const now = new Date();
      await admin
        .from("telegram_auto_post_settings")
        .update({ last_run_at: now.toISOString() })
        .eq("id", 1);
      nextDueAt = new Date(now.getTime() + settings.interval_minutes * 60_000).toISOString();
    } else if (settings.last_run_at) {
      nextDueAt = new Date(
        new Date(settings.last_run_at).getTime() + settings.interval_minutes * 60_000,
      ).toISOString();
    }

    return new Response(
      JSON.stringify({ ok: true, posted, errors, forced: force, mode: queueMode ? "queue" : "rotate", next_due_at: nextDueAt }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
