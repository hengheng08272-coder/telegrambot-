import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { getCurrentTelegramUser } from '@/lib/telegram';

// A genuinely live count of people with the Mini App open right now,
// using Supabase Realtime Presence — not a fake/randomized number. Every
// client that mounts this hook "tracks" itself on a shared channel;
// Supabase keeps every connected client's presence state in sync, so
// counting the channel's presence state gives an accurate live total
// across everyone currently in the app, updating within a second or two
// of people arriving or leaving.
export function usePresenceCount(): number {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const user = getCurrentTelegramUser();
    // Random per-tab id when there's no Telegram identity (e.g. local
    // dev/preview) so presence still works, just without a stable key.
    const presenceKey = user ? String(user.id) : `guest-${Math.random().toString(36).slice(2)}`;

    const channel = supabase.channel('app-presence', {
      config: { presence: { key: presenceKey } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setCount(Math.max(1, Object.keys(state).length));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}
