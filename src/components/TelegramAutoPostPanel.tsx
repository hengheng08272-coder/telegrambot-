import { useEffect, useState } from 'react';
import { Loader2, Send, Save, Bot } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { fetchTelegramAutoPostSettings, saveTelegramAutoPostSettings } from '@/lib/api';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

export default function TelegramAutoPostPanel({ onClose }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(180);
  const [showsPerRun, setShowsPerRun] = useState(1);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const settings = await fetchTelegramAutoPostSettings();
    if (settings) {
      setEnabled(settings.enabled);
      setIntervalMinutes(settings.interval_minutes);
      setShowsPerRun(settings.shows_per_run);
      setLastRunAt(settings.last_run_at);
    }
    setLoaded(true);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await saveTelegramAutoPostSettings({
        enabled,
        interval_minutes: intervalMinutes,
        shows_per_run: showsPerRun,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Fires one run right now, ignoring the interval — a quick way to check
  // the bot, group id, and poster/caption formatting actually work before
  // waiting for the schedule to come around. Settings are saved first so
  // a "Post now" right after editing the count/interval uses the values
  // on screen, not whatever was last saved.
  const handlePostNow = async () => {
    setPosting(true);
    setPostResult(null);
    setError('');
    try {
      await saveTelegramAutoPostSettings({
        enabled,
        interval_minutes: intervalMinutes,
        shows_per_run: showsPerRun,
      });
      const { data, error: fnError } = await supabase.functions.invoke('telegram-auto-post', {
        body: { force: true },
      });
      if (fnError) throw fnError;
      if (data?.skipped) {
        setPostResult(`Skipped: ${data.skipped}`);
      } else {
        setPostResult(`Posted ${data?.posted?.length ?? 0} show(s)`);
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to post');
    } finally {
      setPosting(false);
    }
  };

  return (
    <AdminPanelShell
      title="Telegram Auto-Post"
      subtitle="Automatically post rotating shows into the VIP group — poster, title, synopsis, current episode, and a watch-now link"
      icon={<Bot className="h-4 w-4" />}
      accent="#4C6FFF"
      maxWidth="max-w-[700px]"
      error={error}
      onDismissError={() => setError('')}
      onClose={onClose}
    >
      {!loaded ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-white/40" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-bold text-white">Enable auto-posting</span>
                <span className="block text-xs text-white/50">
                  When off, nothing posts even if the schedule is due.
                </span>
              </span>
              <button
                onClick={() => setEnabled((v) => !v)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                  enabled ? 'bg-[#2FD98C]' : 'bg-white/15'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                    enabled ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-white/50">
                Post every (minutes)
              </label>
              <input
                type="number"
                min={5}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Math.max(5, Number(e.target.value) || 5))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#2050D8]/50"
              />
              <p className="mt-1.5 text-[11px] text-white/40">
                E.g. 180 = every 3 hours. 1440 = once a day.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-white/50">
                Shows per post
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={showsPerRun}
                onChange={(e) => setShowsPerRun(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#2050D8]/50"
              />
              <p className="mt-1.5 text-[11px] text-white/40">
                How many titles get posted each time it runs.
              </p>
            </div>
          </div>

          <p className="text-xs text-white/40">
            {lastRunAt ? `Last ran: ${new Date(lastRunAt).toLocaleString()}` : 'Never run yet.'} Rotates through
            every show so the same title isn't repeated until every other one has had a turn.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <Save className="h-4 w-4 text-[#2FD98C]" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saved ? 'Saved' : 'Save settings'}
            </button>
            <button
              onClick={handlePostNow}
              disabled={posting}
              className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 py-2.5 text-sm font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Post now (test)
            </button>
          </div>
          {postResult && <p className="text-center text-xs text-[#2FD98C]">{postResult}</p>}
        </div>
      )}
    </AdminPanelShell>
  );
}
