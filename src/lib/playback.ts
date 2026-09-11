import { supabase } from '@/lib/supabase/supabaseClient';
import { getTelegramInitData } from '@/lib/telegram';

/** The refusals `episode-stream` can return, verbatim. */
export type PlaybackDenial =
  | 'not_verified'
  | 'not_purchased'
  | 'not_subscribed'
  | 'no_video'
  | 'not_found';

export interface PlaybackResult {
  url: string | null;
  /** True when the URL came back as a short-lived signed link. False
   *  means playback was allowed but the file could not be signed — an
   *  externally hosted video, or the bucket not yet private. */
  signed: boolean;
  denial: PlaybackDenial | null;
}

/**
 * Ask the server for something playable.
 *
 * The episode's own `video_url` is deliberately not the source of truth.
 * `episode-stream` verifies the Telegram signature, checks the
 * subscription or purchase against the database, and only then returns a
 * URL — signed, where the file is in our own bucket.
 *
 * Note there is no early return for "not running inside Telegram". The
 * function serves free shows and free-preview episodes without any
 * identity at all, so a browser with no initData still gets those and is
 * refused everything else — which is the correct answer, and one only
 * the server can give.
 */
export async function fetchEpisodePlayUrl(
  episodeId: string,
  fallbackUrl?: string | null,
): Promise<PlaybackResult> {
  try {
    const { data, error } = await supabase.functions.invoke('episode-stream', {
      body: { episode_id: episodeId, init_data: getTelegramInitData() },
    });
    if (error) throw error;

    if (data?.url) return { url: data.url, signed: !!data.signed, denial: null };
    return { url: null, signed: false, denial: (data?.error as PlaybackDenial) ?? 'no_video' };
  } catch (e) {
    // A refusal is not an outage. `functions.invoke` throws on any
    // non-2xx, so "you have not paid" (403) arrives here looking exactly
    // like a dropped connection — and falling back to the stored URL on
    // that would hand the file to the very viewer the server just turned
    // away. Only a genuine transport failure gets the fallback.
    const status = (e as { context?: { status?: number } })?.context?.status;
    if (status === 401) return { url: null, signed: false, denial: 'not_verified' };
    if (status === 403) return { url: null, signed: false, denial: 'not_subscribed' };
    if (status === 404) return { url: null, signed: false, denial: 'no_video' };
    console.error('[fetchEpisodePlayUrl] gate unreachable:', e);
    return { url: fallbackUrl ?? null, signed: false, denial: null };
  }
}
