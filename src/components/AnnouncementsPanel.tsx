import { useEffect, useState } from 'react';
import { Loader2, Megaphone, Send, Trash2, Eye, EyeOff, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { fetchTickerMessage, saveTickerMessage } from '@/lib/api';
import AdminPanelShell from '@/components/AdminPanelShell';

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

  // Ticker text (the scrolling line under the header) — separate from the
  // announcement list below, but lives in the same panel since both are
  // "what viewers see near the top of the home screen".
  const [tickerDraft, setTickerDraft] = useState('');
  const [tickerLoaded, setTickerLoaded] = useState(false);
  const [tickerSaving, setTickerSaving] = useState(false);
  const [tickerSaved, setTickerSaved] = useState(false);

  useEffect(() => {
    fetchTickerMessage().then((msg) => {
      if (msg) setTickerDraft(msg);
      setTickerLoaded(true);
    });
  }, []);

  const handleSaveTicker = async () => {
    const value = tickerDraft.trim();
    if (!value) return;
    setTickerSaving(true);
    setError('');
    try {
      await saveTickerMessage(value);
      setTickerSaved(true);
      setTimeout(() => setTickerSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save ticker text');
    } finally {
      setTickerSaving(false);
    }
  };

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
    <AdminPanelShell
      title="Announcements"
      subtitle="Ticker text and the banner announcements shown on the home screen"
      icon={<Megaphone className="h-4 w-4" />}
      accent="#F5C563"
      maxWidth="max-w-[900px]"
      onClose={onClose}
    >

        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">
            Ticker text (scrolls under the header)
          </p>
          <textarea
            value={tickerDraft}
            onChange={(e) => setTickerDraft(e.target.value)}
            placeholder={tickerLoaded ? '' : 'Loading current ticker text…'}
            rows={2}
            className="mb-2 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#FF2D46]/50"
          />
          <button
            onClick={handleSaveTicker}
            disabled={tickerSaving || !tickerDraft.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/10 py-2 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-50"
          >
            {tickerSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : tickerSaved ? (
              <Save className="h-4 w-4 text-[#2FD98C]" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {tickerSaved ? 'Saved' : 'Save ticker text'}
          </button>
        </div>

        <div className="mb-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ឧ. ថ្ងៃនេះ episode ថ្មីចេញ 3 ភាគ! / ថ្ងៃស្អែក spin ថ្មីមកដល់..."
            rows={3}
            className="mb-2 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#FF2D46]/50"
          />
          {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
          <button
            onClick={handlePost}
            disabled={posting || !draft.trim()}
            className="btn-primary flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
          >
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Post announcement
          </button>
        </div>

        <div className="space-y-2">
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
                  item.active ? 'border-[#F5C563]/25 bg-[#F5C563]/5' : 'border-white/10 bg-white/[0.03]'
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
    </AdminPanelShell>
  );
}
