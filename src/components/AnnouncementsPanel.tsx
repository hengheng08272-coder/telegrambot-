import { useEffect, useState } from 'react';
import { Loader2, Megaphone, Send, Trash2, X, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';

interface Props {
  onClose: () => void;
}

interface Announcement {
  id: string;
  message: string;
  active: boolean;
  created_at: string;
}

export default function AnnouncementsPanel({ onClose }: Props) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('announcements')
      .select('id, message, active, created_at')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    setItems(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handlePost = async () => {
    const message = draft.trim();
    if (!message) return;
    setPosting(true);
    setError('');
    const { error: err } = await supabase.from('announcements').insert({ message, active: true });
    setPosting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDraft('');
    load();
  };

  const toggleActive = async (item: Announcement) => {
    await supabase.from('announcements').update({ active: !item.active }).eq('id', item.id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this announcement?')) return;
    await supabase.from('announcements').delete().eq('id', id);
    load();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-[#161228] p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Megaphone className="h-4 w-4 text-[#FFC94A]" />
            <h2 className="text-sm font-bold">Announcements (home screen)</h2>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ឧ. ថ្ងៃនេះ episode ថ្មីចេញ 3 ភាគ! / ថ្ងៃស្អែក spin ថ្មីមកដល់..."
            rows={3}
            className="mb-2 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#A855F7]/50"
          />
          {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
          <button
            onClick={handlePost}
            disabled={posting || !draft.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#A855F7] to-[#7C3AED] py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
          >
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Post announcement
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-xs text-white/40">No announcements yet.</p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className={`rounded-xl border px-3 py-2.5 ${
                  item.active ? 'border-[#FFC94A]/25 bg-[#FFC94A]/5' : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <p className={`mb-2 text-sm ${item.active ? 'text-white' : 'text-white/40 line-through'}`}>
                  {item.message}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleActive(item)}
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/70 transition hover:bg-white/10"
                  >
                    {item.active ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {item.active ? 'Hide' : 'Show'}
                  </button>
                  <button
                    onClick={() => remove(item.id)}
                    className="flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/5 px-2.5 py-1 text-xs text-red-300 transition hover:bg-red-500/15"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
