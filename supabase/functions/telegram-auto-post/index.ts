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
//   TELEGRAM_MINIAPP_URL   - optional. A t.me Mini App link such as
//                            https://t.me/AnimetioMini_bot/app (no query
//                            string). Anything that is not a t.me link is
//                            ignored and the link is built from getMe.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // supabase-js attaches `apikey` and `x-client-info` to every
  // functions.invoke() call. Listing only Content-Type and Authorization
  // failed the browser's CORS preflight, so the real POST never left the
  // Admin Panel: "Post now (test)" reported "Failed to send a request to
  // the Edge Function" while the cron path — no browser, no preflight —
  // was unaffected. verify-membership had this exact bug once already.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The "watch now" button must be a Telegram deep link
// (https://t.me/<bot>/<app>?startapp=...), not the site's own https URL.
// TELEGRAM_MINIAPP_URL had been set to the Vercel address, so Telegram
// treated the button as an ordinary web link: tapping it raised "Do you
// want to open ...?" and threw the viewer into a browser, outside the
// Mini App, with no Telegram identity and therefore no VIP.
//
// Rather than depend on that secret being right, the bot's own username
// is read from getMe when it isn't — the bot token is already here, so
// this needs no new configuration. TELEGRAM_MINIAPP_SHORT_NAME overrides
// the "app" path segment if the Mini App is published under another one.
async function miniAppBase(botToken: string): Promise<{ base: string; source: string; note: string | null }> {
  const configured = (Deno.env.get("TELEGRAM_MINIAPP_URL") ?? "").trim().replace(/\/+$/, "");
  const shortName =
    (Deno.env.get("TELEGRAM_MINIAPP_SHORT_NAME") ?? "").trim().replace(/^\/+|\/+$/g, "");

  const me = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
    .then((r) => r.json())
    .catch(() => null);
  const username: string | null = me?.ok ? (me.result?.username ?? null) : null;
  // Telegram's own answer to "does this bot have a Main Mini App?".
  // A Main Mini App has NO short name and is opened with a bare
  // https://t.me/<bot>?startapp=... — appending a path segment to it
  // points at a named app that does not exist, and the button silently
  // does nothing when tapped. That is exactly what was happening: the
  // short name was unset, so the old code defaulted it to "app" and
  // built https://t.me/<bot>/app for a bot whose app has no name.
  const hasMainApp: boolean = me?.ok ? me.result?.has_main_web_app === true : false;

  // A configured t.me link is checked, not trusted. The old test was
  // `/^https:\/\/t\.me\//` and nothing more, so ANY t.me address came
  // back as-is -- including the group link (https://t.me/nintplex), the
  // single easiest wrong value to paste into a variable with this name.
  if (/^https:\/\/t\.me\//i.test(configured)) {
    try {
      const parts = new URL(configured).pathname.split("/").filter(Boolean);
      if (username && parts[0]?.toLowerCase() === username.toLowerCase()) {
        return {
          base: `https://t.me/${parts[0]}${parts[1] ? `/${parts[1]}` : ""}`,
          source: "TELEGRAM_MINIAPP_URL",
          note: null,
        };
      }
    } catch {
      // not a parseable URL -- fall through
    }
  }

  if (!username) {
    return {
      base: configured,
      source: "TELEGRAM_MINIAPP_URL (getMe failed)",
      note:
        "Could not resolve the bot username from getMe, so the button falls back to " +
        `TELEGRAM_MINIAPP_URL (${configured || "unset"}), which opens in a browser outside Telegram.`,
    };
  }

  // An explicitly configured short name wins: the owner has told us the
  // app is named, and getMe cannot report a named app's short name.
  if (shortName) {
    return {
      base: `https://t.me/${username}/${shortName}`,
      source: "getMe + TELEGRAM_MINIAPP_SHORT_NAME",
      note: `Short name "${shortName}" is taken on trust — Telegram has no API to list a bot's Mini Apps, so if it is wrong the button does nothing. Check BotFather → /myapps.`,
    };
  }

  return {
    base: `https://t.me/${username}`,
    source: hasMainApp ? "getMe (Main Mini App)" : "getMe (no app found)",
    note: hasMainApp
      ? null
      : `@${username} reports no Main Mini App and TELEGRAM_MINIAPP_SHORT_NAME is unset, so this link opens the bot's chat rather than the app. Set the short name, or publish a Main Mini App in BotFather.`,
  };
}

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
    const miniApp = await miniAppBase(botToken);
    const miniAppUrl = miniApp.base;
    if (miniApp.note) console.warn("[MINIAPP]", miniApp.note);
    // Echoed on every response, including the skipped ones, so the exact
    // link the buttons will carry can be read without sending a post.
    const miniAppInfo = { miniapp_base: miniApp.base, miniapp_source: miniApp.source, miniapp_note: miniApp.note };
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
      return new Response(JSON.stringify({ ok: true, skipped: "no_settings_row", ...miniAppInfo }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A forced run is an admin pressing "Post now (test)", so it goes
    // through even while auto-posting is switched off — otherwise there is
    // no way to check the bot token, group id and caption before enabling.
    if (!settings.enabled && !force) {
      return new Response(JSON.stringify({ ok: true, skipped: "disabled", ...miniAppInfo }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!force && settings.last_run_at) {
      const dueAt = new Date(settings.last_run_at).getTime() + settings.interval_minutes * 60_000;
      if (Date.now() < dueAt) {
        return new Response(
          JSON.stringify({ ok: true, skipped: "not_due", due_at: new Date(dueAt).toISOString(), ...miniAppInfo }),
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
        return new Response(JSON.stringify({ ok: true, skipped: "empty_queue", ...miniAppInfo }), {
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
      return new Response(JSON.stringify({ ok: true, skipped: "no_shows", ...miniAppInfo }), {
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

    // Two facts that belong in every caption and change for none of the
    // shows in a run, so they are read once here rather than per show:
    // how big the catalogue is, and what the cheapest way in costs.
    const { count: catalogueCount } = await admin
      .from("shows")
      .select("id", { count: "exact", head: true })
      .eq("coming_soon", false);
    const { data: entryTier } = await admin
      .from("pricing_tiers")
      .select("price")
      .eq("key", "1m")
      .maybeSingle();
    // Never hard-code the price: it lives in pricing_tiers because the
    // owner edits it there, and a caption quoting a stale number is worse
    // than one quoting none.
    const entryPrice = entryTier?.price != null ? String(entryTier.price) : "2";

    const posted: string[] = [];
    const errors: string[] = [];
    for (const show of batch) {
      // The headline is the one line under the title, and the last thing
      // guaranteed to be read: Telegram collapses a photo caption after
      // roughly three lines behind "Show more", so everything below this
      // is a bonus. It therefore carries the concrete offer — how much
      // there is to watch — rather than the old "កំពុងចាក់ដល់ភាគទី 21",
      // which stated a position in a series without ever saying that all
      // 21 episodes are sitting there ready to watch.
      let headline: string;
      if (show.type === "movie") {
        headline = "🎬 ភាពយន្តពេញមួយរឿង";
      } else {
        const { data: latestEp } = await admin
          .from("episodes")
          .select("episode_number")
          .eq("show_id", show.id)
          .order("episode_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        headline = latestEp
          ? `📺 ភាគ ១–${latestEp.episode_number} មើលបានហើយ`
          : "📺 ភាគដំបូងកំពុងមកដល់";
      }
      if (show.status === "completed") headline += " · ✅ ចប់ហើយ";
      else if (show.status === "ongoing") headline += " · 🔴 កំពុងចាក់";

      const deepLink = `${miniAppUrl}?startapp=show_${show.id}`;
      // 220, not 500. A 500-character synopsis pushed every other line of
      // the caption below Telegram's "Show more" fold, so the parts of the
      // post that actually ask the reader for something were never seen.
      const synopsis = show.synopsis ? escapeHtml(truncate(show.synopsis, 220)) : "";

      // is_free was being fetched and then ignored — a free show and a
      // members-only one produced identical posts. They want opposite
      // things from the reader: a free show wants the tap and should
      // mention no price at all, a members-only one is the post that has
      // to sell the membership.
      const accessLine = show.is_free
        ? "🆓 <b>រឿងនេះមើលឥតគិតថ្លៃ</b> — មិនបាច់ជាវ"
        : `👑 <b>សម្រាប់សមាជិក VIP</b> · ត្រឹម <b>$${escapeHtml(entryPrice)}</b> ក្នុង ១ ខែ`;
      const catalogueLine = `🎞 រឿង ${catalogueCount ?? 0}+ · ភាគថ្មីរាល់ថ្ងៃ · HD ភាសាខ្មែរ`;

      // accessLine carries deliberate <b> tags, so it is assembled
      // already-safe and must not be escaped a second time.
      const captionParts = [
        `🔥 <b>${escapeHtml(truncate(show.title, 120))}</b>`,
        escapeHtml(headline),
        synopsis,
        accessLine,
        escapeHtml(catalogueLine),
      ].filter(Boolean);
      const caption = truncateEscaped(captionParts.join("\n\n"), 1024);

      // Buttons are the only part of a post Telegram never truncates, so
      // the price lives here and not only in the caption. The old single
      // "ចូលទស្សនា 📺" made no offer at all: every post showed a title
      // and a way in, and never once said what membership costs — a
      // strange omission for a post whose job is to sell one.
      //
      // A free show keeps a single button. Asking someone to subscribe to
      // something they can already watch adds friction to the one post
      // that has none.
      const replyMarkup = show.is_free
        ? { inline_keyboard: [[{ text: "▶️ មើលឥឡូវ — ឥតគិតថ្លៃ", url: deepLink }]] }
        : {
            inline_keyboard: [
              [{ text: "▶️ មើលឥឡូវ", url: deepLink }],
              [{ text: `👑 ជាវ VIP ត្រឹម $${entryPrice} / ខែ`, url: `${miniAppUrl}?startapp=vip` }],
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
      JSON.stringify({ ok: true, posted, errors, forced: force, mode: queueMode ? "queue" : "rotate", next_due_at: nextDueAt, ...miniAppInfo }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
