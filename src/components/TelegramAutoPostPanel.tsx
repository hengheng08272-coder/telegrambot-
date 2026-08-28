import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, Save, Bot, Clock, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import {
  fetchRecentTelegramAutoPosts,
  fetchTelegramAutoPostSettings,
  nextAutoPostDueAt,
  saveTelegramAutoPostSettings,
  TELEGRAM_AUTO_POST_DEFAULTS,
  TELEGRAM_AUTO_POST_MIN_INTERVAL_MINUTES as MIN_INTERVAL,
  type TelegramAutoPostLogEntry,
  type TelegramAutoPostSettings,
} from '@/lib/api';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

// "in 2h 15m" / "due now" — the schedule is expressed in minutes, so the
// only way to tell it is actually running is to see the next post move.
function formatCountdown(target: Date): string {
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return 'due now — posts on the next cron tick';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
}

export default function TelegramAutoPostPanel({ onClose }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<TelegramAutoPostSettings>(TELEGRAM_AUTO_POST_DEFAULTS);
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(TELEGRAM_AUTO_POST_DEFAULTS.interval_minutes);
  const [showsPerRun, setShowsPerRun] = useState(TELEGRAM_AUTO_POST_DEFAULTS.shows_per_run);
  const [recent, setRecent] = useState<TelegramAutoPostLogEntry[]>([]);

  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);
  const [postFailed, setPostFailed] = useState(false);
  const [error, setError] = useState('');
  // Re-renders the countdown without re-querying, so "next post in 2h 14m"
  // stays honest while the panel sits open.
  const [, setTick] = useState(0);

  const applySettings = (settings: TelegramAutoPostSettings) => {
    setSaved(settings);
    setEnabled(settings.enabled);
    setIntervalMinutes(settings.interval_minutes);
    setShowsPerRun(settings.shows_per_run);
  };

  const load = useCallback(async () => {
    try {
      const settings = await fetchTelegramAutoPostSettings();
      applySettings(settings);
      setRecent(await fetchRecentTelegramAutoPosts(8));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load auto-post settings');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const dirty =
    enabled !== saved.enabled ||
    intervalMinutes !== saved.interval_minutes ||
    showsPerRun !== saved.shows_per_run;

  const persist = async () => {
    const fresh = await saveTelegramAutoPostSettings({
      enabled,
      interval_minutes: intervalMinutes,
      shows_per_run: showsPerRun,
    });
    applySettings(fresh);
    return fresh;
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await persist();
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // Fires one run right now, ignoring both the interval and the on/off
  // switch — a quick way to check the bot, group id, and poster/caption
  // actually work before waiting for the schedule to come around. Settings
  // are saved first so a "Post now" right after editing the count/interval
  // uses the values on screen, not whatever was last saved. A test run
  // deliberately does not move `last_run_at`, so the next scheduled post
  // stays where it was.
  const handlePostNow = async () => {
    setPosting(true);
    setPostResult(null);
    setPostFailed(false);
    setError('');
    try {
      await persist();
      const { data, error: fnError } = await supabase.functions.invoke('telegram-auto-post', {
        body: { force: true },
      });
      if (fnError) throw fnError;
      const failures: string[] = data?.errors ?? [];
      if (data?.skipped) {
        setPostFailed(true);
        setPostResult(
          data.skipped === 'no_settings_row'
            ? 'Skipped: settings row missing — run database/telegram-auto-post-addition.sql.'
            : data.skipped === 'no_shows'
              ? 'Skipped: no shows are eligible (every show is marked coming soon).'
              : `Skipped: ${data.skipped}`,
        );
      } else if (failures.length > 0) {
        setPostFailed(true);
        setPostResult(`Telegram refused ${failures.length} — ${failures.join(' | ')}`);
      } else {
        setPostResult(`Posted ${data?.posted?.length ?? 0} show(s) into the group`);
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to post');
    } finally {
      setPosting(false);
    }
  };

  const dueAt = nextAutoPostDueAt(saved);

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
                  When off, nothing posts on schedule — "Post now" still works for testing.
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
                min={MIN_INTERVAL}
                value={intervalMinutes}
                onChange={(e) =>
                  setIntervalMinutes(Math.max(MIN_INTERVAL, Number(e.target.value) || MIN_INTERVAL))
                }
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#2050D8]/50"
              />
              <p className="mt-1.5 text-[11px] text-white/40">
                E.g. 180 = every 3 hours. 1440 = once a day. Minimum {MIN_INTERVAL}.
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

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Clock className="h-4 w-4 text-[#4C6FFF]" />
              {!saved.enabled
                ? 'Auto-posting is off'
                : dueAt
                  ? `Next post ${formatCountdown(dueAt)}`
                  : 'Next post on the next cron tick (never run yet)'}
            </div>
            <p className="mt-1.5 text-[11px] text-white/40">
              {saved.last_run_at
                ? `Last ran ${new Date(saved.last_run_at).toLocaleString()}.`
                : 'Has not run yet.'}{' '}
              {saved.enabled && dueAt
                ? `Scheduled for ${dueAt.toLocaleString()} (every ${saved.interval_minutes} min).`
                : ''}{' '}
              Rotates through every show so the same title isn't repeated until every other one has had a
              turn.
            </p>
            {dirty && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[#F5C563]">
                <AlertTriangle className="h-3.5 w-3.5" /> Unsaved changes — the schedule above still uses
                the saved values.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : justSaved ? (
                <Save className="h-4 w-4 text-[#2FD98C]" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {justSaved ? 'Saved' : dirty ? 'Save settings' : 'Saved'}
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
          {postResult && (
            <p className={`text-center text-xs ${postFailed ? 'text-red-300' : 'text-[#2FD98C]'}`}>
              {postResult}
            </p>
          )}

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/50">Recent posts</p>
            {recent.length === 0 ? (
              <p className="text-xs text-white/40">Nothing posted yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {recent.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-white/80">{row.show_title}</span>
                    <span className="shrink-0 text-white/40">
                      {new Date(row.posted_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </AdminPanelShell>
  );
}
