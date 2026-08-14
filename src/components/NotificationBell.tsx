import { useEffect, useRef, useState } from 'react';
import { Bell, Megaphone } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';

interface Announcement {
  id: string;
  message: string;
  created_at?: string;
}

interface NotificationBellProps {
  title: string;
  emptyLabel: string;
}

// Lives in the header (per the requested mockup: logo · bell · VIP) and
// reuses the same `announcements` table AnnouncementBanner already reads —
// this just gives viewers a way to reopen/browse them on demand instead of
// only ever seeing the auto-popped banner once per visit.
export default function NotificationBell({ title, emptyLabel }: NotificationBellProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from('announcements')
      .select('id, message, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (active && data) setAnnouncements(data);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={title}
        className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/5 hover:text-white"
      >
        <Bell className="h-4 w-4" />
        {announcements.length > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#E6231F] ring-2 ring-[#0A0A0D]" aria-hidden />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-[70] w-72 overflow-hidden rounded-xl border border-white/10 bg-[#0F1116]/98 shadow-2xl backdrop-blur-md sm:w-80">
          <div className="border-b border-white/10 px-3.5 py-2.5 text-xs font-bold uppercase tracking-wide text-white/50">
            {title}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {announcements.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-xs text-white/40">{emptyLabel}</p>
            ) : (
              announcements.map((a) => (
                <div key={a.id} className="flex items-start gap-2.5 border-b border-white/5 px-3.5 py-3 last:border-0">
                  <Megaphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#E3B341]" />
                  <p className="text-xs leading-snug text-white/85">{a.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
