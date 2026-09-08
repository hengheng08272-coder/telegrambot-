import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send, Save, Bot, AlertTriangle, Repeat, ListOrdered } from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import { fetchTelegramAutoPostSettings, saveTelegramAutoPostSettings, errorMessage } from '@/lib/api';
import AdminPanelShell from '@/components/AdminPanelShell';

interface Props {
  onClose: () => void;
}

/**
 * The auto-post settings, in Khmer, with the one setting that decides
 * everything finally visible.
 *
 * The owner's report was "I can't read it, I don't know how to start it,
 * and it posts the same shows over and over". All three were the same
 * panel's fault:
 *
 *   - it was written in English for someone who reads Khmer;
 *   - `selection_mode` was never shown, so a project sitting in 'queue'
 *     with eight entries posted the same eight titles every single run
 *     with no visible cause and no way to change it;
 *   - and the footer claimed it "rotates through every show so the same
 *     title isn't repeated", which is true of rotate mode and false of
 *     the queue mode it was actually in. The panel was describing a
 *     behaviour it did not have.
 *
 * So the mode is a control now, and the arithmetic that produces the
 * repetition is shown as a sentence rather than left for the owner to
 * infer from the group.
 */
export default function TelegramAutoPostPanel({ onClose }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(180);
  const [showsPerRun, setShowsPerRun] = useState(1);
  const [mode, setMode] = useState<'rotate' | 'queue'>('rotate');
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [queueCount, setQueueCount] = useState<number | null>(null);
  const [catalogueCount, setCatalogueCount] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const [settings, queue, shows] = await Promise.all([
      fetchTelegramAutoPostSettings(),
      supabase.from('telegram_auto_post_queue').select('show_id', { count: 'exact', head: true }),
      supabase.from('shows').select('id', { count: 'exact', head: true }).eq('coming_soon', false),
    ]);
    if (settings) {
      setEnabled(settings.enabled);
      setIntervalMinutes(settings.interval_minutes);
      setShowsPerRun(settings.shows_per_run);
      setMode(settings.selection_mode === 'queue' ? 'queue' : 'rotate');
      setLastRunAt(settings.last_run_at);
    }
    setQueueCount(queue.count ?? 0);
    setCatalogueCount(shows.count ?? 0);
    setLoaded(true);
  };

  useEffect(() => {
    void load();
  }, []);

  // How many different titles the schedule can actually draw from, and
  // therefore whether it must repeat. In queue mode with 8 entries and 10
  // per run, every run posts all 8 — which is exactly what the owner saw
  // and had no way to explain.
  const pool = mode === 'queue' ? queueCount : catalogueCount;
  const repeats = pool !== null && pool > 0 && showsPerRun >= pool;
  const roundTripHours = useMemo(() => {
    if (!pool || pool <= 0 || showsPerRun <= 0) return null;
    const runs = Math.ceil(pool / showsPerRun);
    return ((runs * intervalMinutes) / 60).toFixed(1);
  }, [pool, showsPerRun, intervalMinutes]);

  const persist = () =>
    saveTelegramAutoPostSettings({
      enabled,
      interval_minutes: intervalMinutes,
      shows_per_run: showsPerRun,
      selection_mode: mode,
    });

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await persist();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(errorMessage(e, 'រក្សាទុកមិនបាន'));
    } finally {
      setSaving(false);
    }
  };

  // Fires one run right now, ignoring the interval. Settings are saved
  // first so a test straight after editing uses what is on screen.
  const handlePostNow = async () => {
    setPosting(true);
    setPostResult(null);
    setError('');
    try {
      await persist();
      const { data, error: fnError } = await supabase.functions.invoke('telegram-auto-post', {
        body: { force: true },
      });
      if (fnError) throw fnError;
      if (data?.skipped) setPostResult(`រំលង៖ ${data.skipped}`);
      else setPostResult(`ផុសរួច ${data?.posted?.length ?? 0} រឿង`);
      await load();
    } catch (e: unknown) {
      setError(errorMessage(e, 'ផុសមិនបាន'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <AdminPanelShell
      title="ផុសស្វ័យប្រវត្តិ (Auto-Post)"
      subtitle="ផុសរឿងចូល group ដោយស្វ័យប្រវត្តិ — រូបភាព · ចំណងជើង · ភាគចុងក្រោយ · ប៊ូតុងមើលឥឡូវ និងតម្លៃ VIP"
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
                <span className="block text-xs text-white/50">បើបិទ គ្មានអ្វីផុសទេ ទោះដល់ម៉ោងក៏ដោយ។</span>
              </span>
              <button
                onClick={() => setEnabled((v) => !v)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? 'bg-[#2FD98C]' : 'bg-white/15'}`}
                aria-label="បើក/បិទ"
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${enabled ? 'left-[22px]' : 'left-0.5'}`}
                />
              </button>
            </label>
          </div>

          {/* The setting that was doing all the damage while invisible. */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-white/50">ជ្រើសរឿងយ៉ាងណា</p>
            <p className="mb-3 text-[11px] text-white/40">
              នេះជាការកំណត់ដែលសម្រេចថាតើផុសរឿងដដែលៗឬអត់។
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                onClick={() => setMode('rotate')}
                className={`rounded-lg border p-3 text-left transition ${
                  mode === 'rotate'
                    ? 'border-[#4E86FF]/60 bg-[#4E86FF]/10'
                    : 'border-white/10 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-bold text-white">
                  <Repeat className="h-3.5 w-3.5" /> រឿងទាំងអស់ ផ្លាស់វេន
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-white/50">
                  យករឿងទាំង {catalogueCount ?? '—'} មកផុសវេនៗ។ រឿងណាផុសយូរជាងគេ ផុសមុនគេ —
                  មិនផុសរឿងដដែលឡើងវិញទេ រហូតដល់រឿងឯទៀតបានវេនអស់។
                </span>
              </button>
              <button
                onClick={() => setMode('queue')}
                className={`rounded-lg border p-3 text-left transition ${
                  mode === 'queue'
                    ? 'border-[#4E86FF]/60 bg-[#4E86FF]/10'
                    : 'border-white/10 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-bold text-white">
                  <ListOrdered className="h-3.5 w-3.5" /> តាមបញ្ជីដែលជ្រើសរើស
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-white/50">
                  ផុសតែ {queueCount ?? '—'} រឿងក្នុងបញ្ជីប៉ុណ្ណោះ តាមលំដាប់ដែលបានរៀបទុក។
                </span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-white/50">
                ផុសម្តងរៀងរាល់ (នាទី)
              </label>
              <input
                type="number"
                min={5}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Math.max(5, Number(e.target.value) || 5))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#2050D8]/50"
              />
              <p className="mt-1.5 text-[11px] text-white/40">ឧ. 180 = រៀងរាល់ ៣ ម៉ោង · 1440 = ម្តងក្នុងមួយថ្ងៃ។</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-white/50">
                ផុសម្តងប៉ុន្មានរឿង
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={showsPerRun}
                onChange={(e) => setShowsPerRun(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#2050D8]/50"
              />
              <p className="mt-1.5 text-[11px] text-white/40">ចំនួនរឿងដែលផុសក្នុងមួយដង។</p>
            </div>
          </div>

          {/* The arithmetic, said out loud. Repetition was previously
              something the owner could only discover by watching the
              group; the numbers that cause it were all on this screen. */}
          {repeats ? (
            <div className="flex gap-2.5 rounded-xl border border-[#FFC24D]/30 bg-[#FFC24D]/[0.07] p-3.5 text-[#FFC24D]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs leading-relaxed">
                <b>ផុសរឿងដដែលរាល់ដង។</b> ឥឡូវមានតែ {pool} រឿងឲ្យជ្រើស តែផុស {showsPerRun} រឿងក្នុងមួយដង —
                ដូច្នេះរឿងទាំង {pool} នេះផុសឡើងវិញរាល់ {intervalMinutes} នាទី។
                {mode === 'queue' && catalogueCount && catalogueCount > (queueCount ?? 0)
                  ? ` សូមប្តូរទៅ «រឿងទាំងអស់ ផ្លាស់វេន» (${catalogueCount} រឿង) ឬបន្ថយចំនួនផុសក្នុងមួយដង។`
                  : ' សូមបន្ថយចំនួនផុសក្នុងមួយដង។'}
              </p>
            </div>
          ) : (
            roundTripHours && (
              <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-xs text-white/50">
                មានរឿង <b className="text-white/80">{pool}</b> ក្នុងវេន · ផុស{' '}
                <b className="text-white/80">{showsPerRun}</b> រឿងរៀងរាល់{' '}
                <b className="text-white/80">{intervalMinutes}</b> នាទី → គ្រប់រឿងបានវេនក្នុងរយៈពេលប្រហែល{' '}
                <b className="text-white/80">{roundTripHours}</b> ម៉ោង។
              </p>
            )
          )}

          <p className="text-xs text-white/40">
            {lastRunAt ? `ផុសចុងក្រោយ៖ ${new Date(lastRunAt).toLocaleString()}` : 'មិនទាន់ដែលផុសនៅឡើយទេ។'}
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className={`h-4 w-4 ${saved ? 'text-[#2FD98C]' : ''}`} />}
              {saved ? 'រក្សាទុករួច' : 'រក្សាទុក'}
            </button>
            <button
              onClick={handlePostNow}
              disabled={posting}
              className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 py-2.5 text-sm font-bold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              ផុសសាកឥឡូវ
            </button>
          </div>
          <p className="text-center text-[11px] text-white/35">
            «ផុសសាកឥឡូវ» ផុសចូល group ពិតភ្លាមៗ (មិនមែនការមើលសាកទេ) ហើយមិនប៉ះពាល់ម៉ោងវេនបន្ទាប់។
          </p>
          {postResult && <p className="text-center text-xs text-[#2FD98C]">{postResult}</p>}
        </div>
      )}
    </AdminPanelShell>
  );
}
