import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Vite bakes VITE_* into the bundle at BUILD time, so adding these in the
// hosting dashboard does nothing until the app is rebuilt — and a build
// made without them shipped `createClient(undefined, undefined)`, which
// throws while this module is still being imported: before React mounts,
// before ErrorBoundary exists. The Mini App then opens as a blank screen
// that reacts to nothing, with the real cause only in a console no phone
// shows. The placeholders below keep the import alive so the app can
// render the list below as an actual message instead.
export const missingSupabaseConfig: string[] = [
  supabaseUrl ? null : 'VITE_SUPABASE_URL',
  supabaseAnonKey ? null : 'VITE_SUPABASE_ANON_KEY',
].filter((name): name is string => name !== null);

export const supabase = createClient(
  supabaseUrl || 'https://unconfigured.invalid',
  supabaseAnonKey || 'unconfigured',
);
