/**
 * supabase-js's `functions.invoke()` throws a FunctionsHttpError for any
 * non-2xx response and — in that case — leaves `data` as null, with
 * `error.message` set to the unhelpful generic string "Edge Function
 * returned a non-2xx status code". The actual JSON body we returned
 * (e.g. { error: "Subscription required" }) is still available on
 * `error.context`, which is the raw Response object. This reads that
 * body so the UI (and error logs) show the real reason.
 */
export async function extractFunctionErrorMessage(
  error: unknown,
  data: { error?: string } | null | undefined,
): Promise<string> {
  if (data?.error) return data.error;

  const err = error as { message?: string; context?: Response } | null | undefined;
  const context = err?.context;
  if (context && typeof context.json === 'function') {
    try {
      const cloned = context.clone ? context.clone() : context;
      const body = await cloned.json();
      if (body?.error) return body.error;
    } catch {
      // context wasn't JSON — fall through to the generic message below
    }
  }

  return err?.message || 'Unable to load video';
}
