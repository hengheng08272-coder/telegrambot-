import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Send,
  Save,
  Bot,
  Clock,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  X,
  Plus,
  Search,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import {
  autoPostQueueSupported,
  fetchAutoPostQueue,
  fetchAutoPostShowOptions,
  fetchRecentTelegramAutoPosts,
  fetchTelegramAutoPostSettings,
  nextAutoPostDueAt,
  saveAutoPostQueue,
  saveTelegramAutoPostSettings,
  TELEGRAM_AUTO_POST_DEFAULTS,
  TELEGRAM_AUTO_POST_MIN_INTERVAL_MINUTES as MIN_INTERVAL,
  type AutoPostQueueShow,
  type TelegramAutoPostLogEntry,
  type TelegramAutoPostMode,
  type TelegramAutoPostSettings,
} from '@/lib/api';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

// "នៅ ២ម ១៥ន ទៀត" — the schedule is expressed in minutes, so the only way
// to tell it is actually running is to watch the next post move.
function formatCountdown(target: Date): string {
  const ms = target.getTime() - Date.now();
  if (ms <= 0) return 'ដល់ពេលហើយ — ផុសនៅ cron ជុំបន្ទាប់';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `នៅ ${minutes} នាទីទៀត`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `នៅ ${hours} ម៉ោងទៀត` : `នៅ ${hours} ម៉ោង ${rest} នាទីទៀត`;
}

const formatDateTime = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const sameOrder = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

export default function TelegramAutoPostPanel({ onClose }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<TelegramAutoPostSettings>(TELEGRAM_AUTO_POST_DEFAULTS);
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(TELEGRAM_AUTO_POST_DEFAULTS.interval_minutes);
  const [showsPerRun, setShowsPerRun] = useState(TELEGRAM_AUTO_POST_DEFAULTS.shows_per_run);
  const [mode, setMode] = useState<TelegramAutoPostMode>('rotate');
  const [recent, setRecent] = useState<TelegramAutoPostLogEntry[]>([]);

  // The admin-picked posting order, and every show that could join it.
  const [options, setOptions] = useState<AutoPostQueueShow[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [savedQueue, setSavedQueue] = useState<string[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  // False until database/telegram-auto-post-addition.sql has been re-run on
  // this project: without selection_mode and the queue table the panel
  // still works, it just can't offer the hand-picked list.
  const [queueSupported, setQueueSupported] = useState(true);

  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);
  const [postFailed, setPostFailed] = useState(false);
  const [error, setError] = useState('');
  // Re-renders the countdown without re-querying, so "នៅ ២ម ១៤ន ទៀត"
  // stays honest while the panel sits open.
  const [, setTick] = useState(0);

  const applySettings = (settings: TelegramAutoPostSettings) => {
    setSaved(settings);
    setEnabled(settings.enabled);
    setIntervalMinutes(settings.interval_minutes);
    setShowsPerRun(settings.shows_per_run);
    setMode(settings.selection_mode);
  };

  const load = useCallback(async () => {
    try {
      const [settings, queueIds, showOptions] = await Promise.all([
        fetchTelegramAutoPostSettings(),
        fetchAutoPostQueue(),
        fetchAutoPostShowOptions(),
      ]);
      applySettings(settings);
      setQueue(queueIds);
      setSavedQueue(queueIds);
      setOptions(showOptions);
      setQueueSupported(autoPostQueueSupported());
      setRecent(await fetchRecentTelegramAutoPosts(8));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'ផ្ទុកការកំណត់មិនបាន');
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
    showsPerRun !== saved.shows_per_run ||
    mode !== saved.selection_mode ||
    !sameOrder(queue, savedQueue);

  const persist = async () => {
    if (!sameOrder(queue, savedQueue)) {
      await saveAutoPostQueue(queue);
      setSavedQueue(queue);
    }
    const fresh = await saveTelegramAutoPostSettings({
      enabled,
      interval_minutes: intervalMinutes,
      shows_per_run: showsPerRun,
      selection_mode: mode,
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
      setError(e instanceof Error ? e.message : 'រក្សាទុកមិនបាន');
    } finally {
      setSaving(false);
    }
  };

  // Fires one run right now, ignoring both the interval and the on/off
  // switch — a quick way to check the bot, group id, and poster/caption
  // actually work before waiting for the schedule to come around.
  // Settings are saved first so a test right after editing uses what is
  // on screen. A test run deliberately does not move `last_run_at`, so
  // the next scheduled post stays where it was.
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
            ? 'រំលង៖ គ្មានជួរការកំណត់ — សូម run database/telegram-auto-post-addition.sql'
            : data.skipped === 'no_shows'
              ? 'រំលង៖ គ្មានរឿងសមស្រប (រឿងទាំងអស់ជា Coming soon)'
              : data.skipped === 'empty_queue'
                ? 'រំលង៖ បញ្ជីរឿងដែលជ្រើសរើសនៅទទេ — សូមបន្ថែមរឿងសិន'
                : `រំលង៖ ${data.skipped}`,
        );
      } else if (failures.length > 0) {
        setPostFailed(true);
        setPostResult(`Telegram បដិសេធ ${failures.length} — ${failures.join(' | ')}`);
      } else {
        setPostResult(`ផុសបាន ${data?.posted?.length ?? 0} រឿងចូល group`);
      }
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'ផុសមិនបាន');
    } finally {
      setPosting(false);
    }
  };

  const dueAt = nextAutoPostDueAt(saved);
  const optionsById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return options
      .filter((o) => !queue.includes(o.id))
      .filter((o) => !q || o.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [options, queue, pickerQuery]);

  const move = (index: number, delta: number) => {
    const next = [...queue];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setQueue(next);
  };

  return (
    <AdminPanelShell
      title="ផុសរឿងស្វ័យប្រវត្តិ (Telegram Auto-Post)"
      subtitle="Bot ផុសរឿងចូល VIP group ដោយខ្លួនឯង — poster, ចំណងជើង, សាច់រឿង, ភាគចុងក្រោយ និងប៊ូតុងចូលទស្សនា"
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
                <span className="block text-sm font-bold text-white">បើកការផុសស្វ័យប្រវត្តិ</span>
                <span className="block text-xs text-white/50">
                  ពេលបិទ គ្មានការផុសតាមកាលវិភាគទេ — ប៊ូតុង «ផុសឥឡូវ» នៅតែសាកល្បងបាន។
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
              <label className="mb-2 block text-xs font-bold text-white/50">ផុសរៀងរាល់ (នាទី)</label>
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
                ឧ. 180 = រៀងរាល់ ៣ម៉ោង · 1440 = ១ដងក្នុង១ថ្ងៃ · យ៉ាងតិច {MIN_INTERVAL} នាទី
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <label className="mb-2 block text-xs font-bold text-white/50">ចំនួនរឿងក្នុងមួយដង</label>
              <input
                type="number"
                min={1}
                max={10}
                value={showsPerRun}
                onChange={(e) => setShowsPerRun(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#2050D8]/50"
              />
              <p className="mt-1.5 text-[11px] text-white/40">ផុសម្ដងបានប៉ុន្មានរឿង (១–១០)។</p>
            </div>
          </div>

          {/* Which shows go out, and in what order. */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-2 text-xs font-bold text-white/50">រឿងដែលត្រូវផុស</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    key: 'rotate' as const,
                    title: 'តាមវេនស្វ័យប្រវត្តិ',
                    desc: 'រឿងទាំងអស់ផ្លាស់វេនគ្នា រឿងណាមិនទាន់ផុសយូរជាងគេផុសមុន',
                  },
                  {
                    key: 'queue' as const,
                    title: 'ជ្រើសរើសដោយខ្លួនឯង',
                    desc: 'ផុសតែរឿងក្នុងបញ្ជីខាងក្រោម តាមលំដាប់ដែលបងរៀប',
                  },
                ] satisfies { key: TelegramAutoPostMode; title: string; desc: string }[]
              ).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setMode(opt.key)}
                  disabled={opt.key === 'queue' && !queueSupported}
                  className={`rounded-xl border p-3 text-left transition disabled:opacity-40 ${
                    mode === opt.key
                      ? 'border-[#4C6FFF]/50 bg-[#4C6FFF]/10'
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                  }`}
                >
                  <span
                    className={`block text-sm font-bold ${mode === opt.key ? 'text-[#4C6FFF]' : 'text-white'}`}
                  >
                    {opt.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-white/45">{opt.desc}</span>
                </button>
              ))}
            </div>

            {!queueSupported && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[#F5C563]">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                ដើម្បីជ្រើសរើសរឿងដោយខ្លួនឯង ត្រូវ run
                <code className="mx-1 rounded bg-white/10 px-1">database/telegram-auto-post-addition.sql</code>
                ក្នុង Supabase → SQL Editor ជាមុនសិន។ ឥឡូវនេះកំពុងប្រើ «តាមវេនស្វ័យប្រវត្តិ» ធម្មតា។
              </p>
            )}

            {mode === 'queue' && queueSupported && (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="mb-1.5 text-[11px] font-bold text-white/50">
                    លំដាប់ផុស ({queue.length} រឿង) — លេខ ១ ផុសមុនគេ
                  </p>
                  {queue.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-white/15 px-3 py-4 text-center text-[11px] text-white/40">
                      មិនទាន់មានរឿងទេ — ស្វែងរក រួចចុច ➕ ដើម្បីបន្ថែម
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {queue.map((id, index) => {
                        const show = optionsById.get(id);
                        return (
                          <li
                            key={id}
                            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2"
                          >
                            <span className="w-5 shrink-0 text-center text-[11px] font-bold text-[#4C6FFF]">
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs text-white/85">
                              {show?.title ?? 'រឿងត្រូវបានលុប'}
                              {show?.coming_soon && (
                                <span className="ml-1.5 text-[10px] text-[#FFC24D]">(Coming soon)</span>
                              )}
                            </span>
                            <button
                              onClick={() => move(index, -1)}
                              disabled={index === 0}
                              className="rounded-md border border-white/10 bg-white/5 p-1 text-white/60 transition hover:bg-white/10 disabled:opacity-25"
                              title="ឡើងលើ"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => move(index, 1)}
                              disabled={index === queue.length - 1}
                              className="rounded-md border border-white/10 bg-white/5 p-1 text-white/60 transition hover:bg-white/10 disabled:opacity-25"
                              title="ចុះក្រោម"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setQueue(queue.filter((q) => q !== id))}
                              className="rounded-md border border-red-500/25 bg-red-500/10 p-1 text-red-300 transition hover:bg-red-500/20"
                              title="ដកចេញ"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
                    <input
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder="ស្វែងរករឿងដើម្បីបន្ថែម…"
                      className="w-full rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-8 pr-3 text-xs text-white placeholder-white/40 outline-none focus:border-[#4C6FFF]/50"
                    />
                  </div>
                  {pickerResults.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {pickerResults.map((show) => (
                        <li key={show.id}>
                          <button
                            onClick={() => {
                              setQueue([...queue, show.id]);
                              setPickerQuery('');
                            }}
                            className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-left text-xs text-white/75 transition hover:bg-white/[0.06]"
                          >
                            <Plus className="h-3 w-3 shrink-0 text-[#4C6FFF]" />
                            <span className="truncate">{show.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Clock className="h-4 w-4 text-[#4C6FFF]" />
              {!saved.enabled
                ? 'ការផុសស្វ័យប្រវត្តិកំពុងបិទ'
                : dueAt
                  ? `ផុសលើកក្រោយ ${formatCountdown(dueAt)}`
                  : 'ផុសនៅ cron ជុំបន្ទាប់ (មិនទាន់ធ្លាប់ផុស)'}
            </div>
            <p className="mt-1.5 text-[11px] text-white/40">
              {saved.last_run_at
                ? `ផុសចុងក្រោយ ${formatDateTime(new Date(saved.last_run_at))}។`
                : 'មិនទាន់ធ្លាប់ដំណើរការ។'}{' '}
              {saved.enabled && dueAt
                ? `កំណត់ម៉ោង ${formatDateTime(dueAt)} (រៀងរាល់ ${saved.interval_minutes} នាទី)។`
                : ''}{' '}
              {saved.selection_mode === 'queue'
                ? 'កំពុងផុសតាមបញ្ជីដែលបងជ្រើស វិលជុំពីដើមវិញនៅចុងបញ្ជី។'
                : 'ផ្លាស់វេនគ្រប់រឿង ដូច្នេះរឿងដដែលមិនផុសឡើងវិញមុនរឿងឯទៀតបានវេន។'}
            </p>
            {dirty && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[#F5C563]">
                <AlertTriangle className="h-3.5 w-3.5" /> មានការកែមិនទាន់រក្សាទុក — កាលវិភាគខាងលើនៅប្រើតម្លៃចាស់
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
              {dirty ? 'រក្សាទុក' : 'រក្សាទុករួច'}
            </button>
            <button
              onClick={handlePostNow}
              disabled={posting}
              className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 py-2.5 text-sm font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              ផុសឥឡូវ (សាកល្បង)
            </button>
          </div>
          {postResult && (
            <p className={`text-center text-xs ${postFailed ? 'text-red-300' : 'text-[#2FD98C]'}`}>
              {postResult}
            </p>
          )}

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-2 text-xs font-bold text-white/50">ផុសថ្មីៗ</p>
            {recent.length === 0 ? (
              <p className="text-xs text-white/40">មិនទាន់មានការផុសទេ។</p>
            ) : (
              <ul className="space-y-1.5">
                {recent.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-white/80">{row.show_title}</span>
                    <span className="shrink-0 text-white/40">
                      {formatDateTime(new Date(row.posted_at))}
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
