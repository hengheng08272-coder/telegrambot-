import { supabase } from '@/lib/supabase/supabaseClient';
import { getTelegramInitData } from '@/lib/telegram';

export type PlaybackDenial = 'subscription_required' | 'purchase_required' | 'no_video' | 'unauthenticated';

export interface PlaybackResult {
  url: string | null;
  /** True when the URL came back as a short-lived signed link. False
   *  means the server allowed playback but handed back a plain URL —
   *  an externally hosted file, or the bucket not yet flipped private. */
  signed: boolean;
  denial: PlaybackDenial | null;
}

/**
 * Ask the server for something playable.
 *
 * The episode's own `video_url` is deliberately NOT used as the source
 * of truth any more. It is the server that decides whether this viewer
 * may watch this episode, because the client cannot: a React branch is
 * a variable in a page the viewer controls, and a public bucket URL
 * plays for anyone who has ever seen it.
 *
 * `fallbackUrl` exists only for the window between this code shipping
 * and the bucket actually being made private — and for running outside
 * Telegram, where there is no signature to verify and so no way to
 * establish who is asking. It is dropped the moment the server answers.
 */
export async function fetchEpisodePlayUrl(
  episodeId: string,
  fallbackUrl?: string | null,
): Promise<PlaybackResult> {
  const initData = getTelegramInitData();

  // Outside Telegram there is no signed identity to send, so the gate
  // cannot run at all. Local development keeps working off the stored
  // URL; in production this branch is unreachable, because the app only
  // ever opens as a Mini App.
  if (!initData) {
    return { url: fallbackUrl ?? null, signed: false, denial: null };
  }

  try {
    const { data, error } = await supabase.functions.invoke('get-episode-url', {
      body: { initData, episodeId },
    });
    if (error) throw error;

    if (data?.url) return { url: data.url, signed: !!data.signed, denial: null };
    if (data?.error) return { url: null, signed: false, denial: data.error as PlaybackDenial };
    return { url: null, signed: false, denial: 'no_video' };
  } catch (e) {
    // A refusal is not an outage: `functions.invoke` throws on any
    // non-2xx, so a 403 "you have not paid" lands here too, and falling
    // back to the stored URL on that would hand the file to exactly the
    // viewer the function just turned away. Only a genuine transport
    // failure gets the fallback.
    const status = (e as { context?: { status?: number } })?.context?.status;
    if (status === 401 || status === 403 || status === 404) {
      return { url: null, signed: false, denial: 'subscription_required' };
    }
    console.error('[fetchEpisodePlayUrl] gate unreachable:', e);
    return { url: fallbackUrl ?? null, signed: false, denial: null };
  }
}
