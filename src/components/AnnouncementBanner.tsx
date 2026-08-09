import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';

interface Announcement {
  id: string;
  message: string;
}

// Sits at the very top of the home screen. Fetches whatever the admin
// has marked active (newest first) and lets the viewer dismiss it for
// this visit only — it comes back next time they open the app, which is
// fine since it's meant to be seen, not permanently cleared.
export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    supabase
      .from('announcements')
      .select('id, message')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (active && data) setAnnouncements(data);
      });
    return () => {
      active = false;
    };
  }, []);

  const visible = announcements.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="fixed inset-x-0 top-[96px] z-40 space-y-2 px-4 sm:top-[104px]">
      {visible.map((a) => (
        <div
          key={a.id}
          className="mx-auto flex max-w-[1400px] items-start gap-2.5 rounded-xl border border-[#FFC94A]/25 bg-[#161228]/95 px-3.5 py-2.5 shadow-lg backdrop-blur-md"
        >
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC94A]" />
          <p className="flex-1 text-sm leading-snug text-white/90">{a.message}</p>
          <button
            onClick={() => setDismissed((prev) => new Set(prev).add(a.id))}
            className="shrink-0 text-white/40 transition hover:text-white/80"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
