import { useEffect, useState, useRef } from 'react';
import {
  ArrowLeft,
  Upload,
  Plus,
  Trash2,
  Film,
  Tv,
  Loader2,
  CheckCircle2,
  X,
  Search,
  Video,
  Clock,
  Pencil,
  Link2,
  Play,
  Megaphone,
  Wallet,
  QrCode,
  ShieldBan,
  Eye,
  AlertTriangle,
  Lock,
  Unlock,
  Crown,
  Users as UsersIcon,
  ChevronRight,
  ListVideo,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/supabaseClient';
import type { Show, Episode } from '@/lib/types';
import AnnouncementsPanel from '@/components/AnnouncementsPanel';
import BanLogPanel from '@/components/BanLogPanel';
import WatchLogPanel from '@/components/WatchLogPanel';
import SuspiciousActivityPanel from '@/components/SuspiciousActivityPanel';
import PaymentsPanel from '@/components/PaymentsPanel';
import SubscriptionsPanel from '@/components/SubscriptionsPanel';
import UsersPanel from '@/components/UsersPanel';
import { usePresenceCount } from '@/lib/presence';

interface AdminScreenProps {
  onBack: () => void;
}

interface ShowWithEpisodes extends Show {
  episodes: Episode[];
}

// Reads a remote video's real length so admins never have to type it in
// by hand or copy it off some other player. Resolves null (rather than
// rejecting) on any failure — a metadata read that doesn't work just
// means the duration field stays manual for that one video, not a
// blocking error for the whole "add episode" flow.
function detectDurationMinutes(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    if (!url.trim()) {
      resolve(null);
      return;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    const cleanup = () => {
      video.src = '';
      video.remove();
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const mins = Math.round(video.duration / 60);
      cleanup();
      resolve(mins > 0 && isFinite(mins) ? mins : null);
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve(null);
    };
    video.src = url.trim();
  });
}

export default function AdminScreen({ onBack }: AdminScreenProps) {
  const [shows, setShows] = useState<ShowWithEpisodes[]>([]);
  const watchingNow = usePresenceCount();
  const [watchesToday, setWatchesToday] = useState<number | null>(null);

  // Quick overview numbers for the owner — pulled once on mount, not
  // meant to be a live dashboard, just a glance at how the app is doing.
  useEffect(() => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    supabase
      .from('watch_log')
      .select('id', { count: 'exact', head: true })
      .gte('started_at', since.toISOString())
      .then(({ count }) => setWatchesToday(count ?? 0));
  }, []);
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const [banLogOpen, setBanLogOpen] = useState(false);
  const [watchLogOpen, setWatchLogOpen] = useState(false);
  const [suspiciousOpen, setSuspiciousOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0);
  useEffect(() => {
    supabase
      .from('payment_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingPaymentsCount(count ?? 0));
  }, [paymentsOpen]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  // Which show has the full screen. The old accordion kept every show
  // in one long column and pushed the rest of the list far down the
  // moment one was expanded, so adding episode 40 of a series meant
  // scrolling past everything else first. One show at a time, with the
  // list a single tap away, is what actually matches the job.
  const [focusedShowId, setFocusedShowId] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [addEpOpen, setAddEpOpen] = useState<string | null>(null);
  const [pendingUploadId, setPendingUploadId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pasteUrlFor, setPasteUrlFor] = useState<string | null>(null);
  const [pasteUrlValue, setPasteUrlValue] = useState('');
  const [savingUrlFor, setSavingUrlFor] = useState<string | null>(null);
  const [newEp, setNewEp] = useState({
    episode_number: '',
    season: '1',
    title: '',
    description: '',
    duration: '',
    video_url: '',
  });
  const [busy, setBusy] = useState(false);

  // Admin preview modal — lets admin check an uploaded episode plays
  // correctly, bypassing the subscription check via the is_admin flag
  // in get-video-url.
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // New show / movie creation
  const [addShowOpen, setAddShowOpen] = useState(false);
  const [newShow, setNewShow] = useState({
    title: '',
    type: 'series' as 'series' | 'movie',
    synopsis: '',
    release_year: '',
    studio: '',
    featured: false,
    coming_soon: false,
    is_free: false,
  });
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [creatingShow, setCreatingShow] = useState(false);

  // Edit existing show
  const [editShow, setEditShow] = useState<ShowWithEpisodes | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSynopsis, setEditSynopsis] = useState('');
  const [editRating, setEditRating] = useState('');
  const [editViewCount, setEditViewCount] = useState('');
  const [editComingSoon, setEditComingSoon] = useState(false);
  const [editIsFree, setEditIsFree] = useState(false);
  const [episodeLockBusyId, setEpisodeLockBusyId] = useState<string | null>(null);
  const [bulkLockBusyShowId, setBulkLockBusyShowId] = useState<string | null>(null);
  const [editPosterFile, setEditPosterFile] = useState<File | null>(null);
  const [editBannerFile, setEditBannerFile] = useState<File | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  const loadShows = async () => {
    setLoading(true);
    const { data: showData, error: showErr } = await supabase
      .from('shows')
      .select('*')
      .order('title', { ascending: true });
    if (showErr) {
      setError(showErr.message);
      setLoading(false);
      return;
    }
    // supabase-js only sorts by ONE column per .order() call — a
    // comma-joined string like 'show_id, season, episode_number' is NOT
    // valid multi-column sorting, it silently falls back to insertion
    // order. Chain .order() per column so episodes always line up by
    // number regardless of the order they were uploaded in (e.g.
    // uploading ep5, ep6, then ep4 still lists as ep4, ep5, ep6).
    const { data: epData, error: epErr } = await supabase
      .from('episodes')
      .select('*')
      .order('show_id', { ascending: true })
      .order('season', { ascending: true })
      .order('episode_number', { ascending: true });
    if (epErr) {
      setError(epErr.message);
      setLoading(false);
      return;
    }
    const epsByShow = (epData ?? []).reduce<Record<string, Episode[]>>((acc, ep) => {
      if (!acc[ep.show_id]) acc[ep.show_id] = [];
      acc[ep.show_id].push(ep);
      return acc;
    }, {});
    setShows(
      (showData ?? []).map((s) => ({
        ...s,
        episodes: epsByShow[s.id] ?? [],
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    loadShows();
  }, []);

  const filteredShows = search.trim()
    ? shows.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
    : shows;

  // "Continue posting" queue — ongoing series (not movies, not coming-soon
  // announcements with nothing to post yet) ranked by how long it's been
  // since the last episode went up, oldest first. This is the fast path
  // for "what needs a new episode today" instead of scrolling/searching
  // the full show list to find it.
  const continuePostingShows = shows
    .filter((s) => s.type !== 'movie' && !s.coming_soon)
    .map((s) => {
      const last = s.episodes[s.episodes.length - 1];
      return { show: s, lastAt: last?.created_at ? new Date(last.created_at).getTime() : 0 };
    })
    .sort((a, b) => a.lastAt - b.lastAt)
    .slice(0, 6)
    .map((x) => x.show);

  const addEpisodeRef = useRef<HTMLDivElement | null>(null);

  // Shared "jump to this show and open a pre-filled Add Episode form"
  // action — used by both the per-show Add Episode button and the
  // Continue Posting quick-picker above the list, so the two paths never
  // drift out of sync on how the next episode number/season is computed.
  const openAddEpisodeFor = (show: ShowWithEpisodes) => {
    const nextNumber = show.episodes.reduce((max, ep) => Math.max(max, ep.episode_number), 0) + 1;
    setNewEp({
      episode_number: String(nextNumber),
      season: String(show.episodes[show.episodes.length - 1]?.season ?? 1),
      title: show.type === 'movie' ? '' : `Episode ${nextNumber}`,
      description: '',
      duration: '',
      video_url: '',
    });
    setFocusedShowId(show.id);
    setAddEpOpen(show.id);
    requestAnimationFrame(() => {
      addEpisodeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const triggerFileUpload = (episodeId: string) => {
    setPendingUploadId(episodeId);
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const epId = pendingUploadId;
    e.target.value = '';
    setPendingUploadId(null);
    if (file && epId) handleUploadVideo(file, epId);
  };

  const handleUploadVideo = async (file: File, episodeId: string) => {
    setUploadingFor(episodeId);
    setUploadProgress(0);
    setError('');

    const ext = file.name.split('.').pop() || 'mp4';
    const path = `${episodeId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('videos')
      .upload(path, file, {
        upsert: true,
        contentType: file.type || 'video/mp4',
      });

    if (uploadError) {
      setError(uploadError.message);
      setUploadingFor(null);
      return;
    }

    // The videos bucket is private now — store the bare storage path.
    // Playback resolves it to a short-lived signed URL via the
    // get-video-url Edge Function, never a permanent public URL.
    const { error: updateErr } = await supabase
      .from('episodes')
      .update({ video_url: path })
      .eq('id', episodeId);

    if (updateErr) {
      setError(updateErr.message);
      setUploadingFor(null);
      return;
    }

    setUploadProgress(100);
    setUploadingFor(null);
    setUploadProgress(0);
    await loadShows();
  };

  const handleSaveVideoUrl = async (episodeId: string) => {
    const url = pasteUrlValue.trim();
    if (!url) return;

    setSavingUrlFor(episodeId);
    setError('');

    // Same auto-detect as adding a new episode — re-pasting/replacing a
    // link re-reads the duration too, so it never goes stale against
    // whatever file is actually live at that URL now.
    const durationMinutes = await detectDurationMinutes(url);

    const { error: updateErr } = await supabase
      .from('episodes')
      .update({
        video_url: url,
        ...(durationMinutes ? { duration: durationMinutes } : {}),
      })
      .eq('id', episodeId);

    if (updateErr) {
      setError(updateErr.message);
      setSavingUrlFor(null);
      return;
    }

    setSavingUrlFor(null);
    setPasteUrlFor(null);
    setPasteUrlValue('');
    await loadShows();
  };

  const handlePreviewVideo = (episodeId: string) => {
    setPreviewFor(episodeId);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewUrl(null);
    const ep = shows.flatMap((s) => s.episodes).find((e) => e.id === episodeId);
    setPreviewLoading(false);
    if (!ep?.video_url) {
      setPreviewError('No video uploaded for this episode yet.');
      return;
    }
    setPreviewUrl(ep.video_url);
  };

  const closePreview = () => {
    setPreviewFor(null);
    setPreviewUrl(null);
    setPreviewError('');
  };

  const handleDeleteEpisode = async (episodeId: string) => {
    if (!confirm('Delete this episode? This cannot be undone.')) return;
    const { error } = await supabase.from('episodes').delete().eq('id', episodeId);
    if (error) {
      setError(error.message);
      return;
    }
    await loadShows();
  };

  // Per-episode free-preview toggle — this is the "unlock one episode"
  // control. Episodes are locked (is_free_preview = false) by default from
  // the moment they're created (see free-content-addition.sql), so this is
  // purely opt-in unlocking, not a separate lock step.
  const handleToggleEpisodeFree = async (ep: Episode) => {
    setEpisodeLockBusyId(ep.id);
    const { error: toggleErr } = await supabase
      .from('episodes')
      .update({ is_free_preview: !ep.is_free_preview })
      .eq('id', ep.id);
    setEpisodeLockBusyId(null);
    if (toggleErr) {
      setError(toggleErr.message);
      return;
    }
    await loadShows();
  };

  // Bulk unlock/lock every episode of one show at once — "unlock all" and
  // "lock all" from the same button, depending on current state.
  const handleBulkSetEpisodesFree = async (showId: string, episodeIds: string[], value: boolean) => {
    if (episodeIds.length === 0) return;
    setBulkLockBusyShowId(showId);
    const { error: bulkErr } = await supabase
      .from('episodes')
      .update({ is_free_preview: value })
      .in('id', episodeIds);
    setBulkLockBusyShowId(null);
    if (bulkErr) {
      setError(bulkErr.message);
      return;
    }
    await loadShows();
  };

  const handleAddEpisode = async (showId: string, movieTitle?: string) => {
    setBusy(true);
    setError('');
    const epNumber = movieTitle ? 1 : parseInt(newEp.episode_number) || 1;

    // If the admin didn't type a duration, read it straight off the video
    // file itself rather than leaving it blank or making them go copy it
    // from somewhere else.
    let durationMinutes = newEp.duration ? parseInt(newEp.duration) : null;
    if (!durationMinutes && newEp.video_url.trim()) {
      durationMinutes = await detectDurationMinutes(newEp.video_url);
    }

    const { error } = await supabase.from('episodes').insert({
      show_id: showId,
      episode_number: epNumber,
      season: movieTitle ? 1 : parseInt(newEp.season) || 1,
      title: movieTitle || newEp.title.trim() || `Episode ${epNumber}`,
      description: newEp.description.trim() || null,
      duration: durationMinutes,
      video_url: newEp.video_url.trim() || null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (movieTitle) {
      // Movies only ever get one slot — close the form like before.
      setNewEp({ episode_number: '', season: '1', title: '', description: '', duration: '', video_url: '' });
      setAddEpOpen(null);
    } else {
      // Series: keep the form open and bump the episode number so the
      // admin can immediately paste the next episode's link — fill ep 1,
      // hit Add, the form clears and jumps to ep 2, paste, Add, ep 3…
      setNewEp({
        episode_number: String(epNumber + 1),
        season: newEp.season,
        title: `Episode ${epNumber + 1}`,
        description: '',
        duration: '',
        video_url: '',
      });
    }
    await loadShows();
  };

  const uploadImage = async (
    bucket: 'posters',
    file: File,
    pathPrefix: string,
  ): Promise<string | null> => {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${pathPrefix}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (upErr) {
      setError(upErr.message);
      return null;
    }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  };

  const handleCreateShow = async () => {
    if (!newShow.title.trim()) {
      setError('Title is required');
      return;
    }
    setCreatingShow(true);
    setError('');

    let poster_url: string | null = null;
    let banner_url: string | null = null;

    if (posterFile) {
      poster_url = await uploadImage('posters', posterFile, 'poster');
      if (posterFile && !poster_url) {
        setCreatingShow(false);
        return;
      }
    }
    if (bannerFile) {
      banner_url = await uploadImage('posters', bannerFile, 'banner');
      if (bannerFile && !banner_url) {
        setCreatingShow(false);
        return;
      }
    }

    const { error: insertErr } = await supabase.from('shows').insert({
      title: newShow.title.trim(),
      type: newShow.type,
      synopsis: newShow.synopsis.trim() || null,
      release_year: newShow.release_year ? parseInt(newShow.release_year) : null,
      studio: newShow.studio.trim() || null,
      featured: newShow.featured,
      coming_soon: newShow.coming_soon,
      is_free: newShow.is_free,
      poster_url,
      banner_url,
    });

    setCreatingShow(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }

    setNewShow({
      title: '',
      type: 'series',
      synopsis: '',
      release_year: '',
      studio: '',
      featured: false,
      coming_soon: false,
      is_free: false,
    });
    setPosterFile(null);
    setBannerFile(null);
    setAddShowOpen(false);
    await loadShows();
  };

  const openEdit = (show: ShowWithEpisodes) => {
    setEditShow(show);
    setEditTitle(show.title);
    setEditSynopsis(show.synopsis ?? '');
    setEditRating(show.rating != null ? String(show.rating) : '');
    setEditViewCount(show.view_count != null ? String(show.view_count) : '0');
    setEditComingSoon(show.coming_soon ?? false);
    setEditIsFree(show.is_free ?? false);
    setEditPosterFile(null);
    setEditBannerFile(null);
    setEditSuccess(false);
  };

  const handleSaveEdit = async () => {
    if (!editShow) return;
    if (!editTitle.trim()) {
      setError('Title is required');
      return;
    }
    setSavingEdit(true);
    setError('');

    const updates: Record<string, string | number | boolean | null> = {
      title: editTitle.trim(),
      synopsis: editSynopsis.trim() || null,
      rating: editRating.trim() ? parseFloat(editRating) : 0,
      view_count: editViewCount.trim() ? parseInt(editViewCount, 10) || 0 : 0,
      coming_soon: editComingSoon,
      is_free: editIsFree,
    };

    if (editPosterFile) {
      const url = await uploadImage('posters', editPosterFile, `poster-${editShow.id}`);
      if (!url) {
        setSavingEdit(false);
        return;
      }
      updates.poster_url = url;
    }
    if (editBannerFile) {
      const url = await uploadImage('posters', editBannerFile, `banner-${editShow.id}`);
      if (!url) {
        setSavingEdit(false);
        return;
      }
      updates.banner_url = url;
    }

    const { error: updErr } = await supabase
      .from('shows')
      .update(updates)
      .eq('id', editShow.id);

    setSavingEdit(false);
    if (updErr) {
      setError(updErr.message);
      return;
    }

    setEditSuccess(true);
    setTimeout(() => {
      setEditShow(null);
      setEditSuccess(false);
    }, 1200);
    await loadShows();
  };

  // The show that currently owns the screen, resolved fresh from
  // `shows` on every render so an upload or delete inside the workspace
  // is reflected immediately without a second source of truth.
  const focusedShow = shows.find((item) => item.id === focusedShowId) ?? null;
  const nextEpisodeNumber = focusedShow
    ? focusedShow.episodes.reduce((max, ep) => Math.max(max, ep.episode_number), 0) + 1
    : 1;

  return (
    <div className="min-h-screen bg-app text-white">
      {/* Header — split into a primary row (back / title / new show / search)
          and a horizontally-scrollable pill nav for the other admin
          sections below, instead of one long wrapping row of buttons. */}
      <header className="sticky top-0 z-50 border-b border-white/10 bar-blur">
        <div className="mx-auto flex max-w-[1200px] items-center gap-3 px-4 pt-4 sm:px-8">
          <button
            onClick={onBack}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h1 className="hidden text-lg font-bold sm:block">Admin</h1>
          <button
            onClick={() => setAddShowOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#2FD98C] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#4C6FFF]"
          >
            <Plus className="h-4 w-4" /> New Show
          </button>
          <div className="relative ml-auto min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shows…"
              className="w-full rounded-full border border-white/10 bg-white/[0.04] py-2 pl-9 pr-4 text-sm text-white placeholder-white/40 outline-none focus:border-[#2FD98C]/50"
            />
          </div>
        </div>
        <nav className="no-scrollbar mx-auto flex max-w-[1200px] items-center gap-2 overflow-x-auto px-4 py-3 sm:px-8">
          <button
            onClick={() => setAnnouncementsOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#F5C563]/30 bg-[#F5C563]/10 px-3.5 py-1.5 text-xs font-bold text-[#F5C563] transition hover:bg-[#F5C563]/20"
          >
            <Megaphone className="h-3.5 w-3.5" /> Announcements
          </button>
          <button
            onClick={() => setPaymentsOpen(true)}
            className="relative flex shrink-0 items-center gap-1.5 rounded-xl border border-[#2FD98C]/30 bg-[#2FD98C]/10 px-3.5 py-1.5 text-xs font-bold text-[#2FD98C] transition hover:bg-[#2FD98C]/20"
          >
            <Wallet className="h-3.5 w-3.5" /> Payments
            {pendingPaymentsCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-md bg-[#2050D8] px-1 text-[11px] font-extrabold text-white">
                {pendingPaymentsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setSubscriptionsOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#2FD98C]/30 bg-[#2FD98C]/10 px-3.5 py-1.5 text-xs font-bold text-[#2FD98C] transition hover:bg-[#2FD98C]/20"
          >
            <QrCode className="h-3.5 w-3.5" /> Subscriptions
          </button>
          <button
            onClick={() => setUsersOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#4C6FFF]/30 bg-[#4C6FFF]/10 px-3.5 py-1.5 text-xs font-bold text-[#4C6FFF] transition hover:bg-[#4C6FFF]/20"
          >
            <UsersIcon className="h-3.5 w-3.5" /> Users
          </button>
          <span className="mx-1 h-4 w-px shrink-0 bg-white/10" aria-hidden />
          <button
            onClick={() => setWatchLogOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-xs font-bold text-white/70 transition hover:bg-white/10"
          >
            <Eye className="h-3.5 w-3.5" /> Watch log
          </button>
          <button
            onClick={() => setSuspiciousOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#F5C563]/30 bg-[#F5C563]/10 px-3.5 py-1.5 text-xs font-bold text-[#F5C563] transition hover:bg-[#F5C563]/20"
          >
            <AlertTriangle className="h-3.5 w-3.5" /> Suspicious
          </button>
          <button
            onClick={() => setBanLogOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-500/20"
          >
            <ShieldBan className="h-3.5 w-3.5" /> Ban log
          </button>
        </nav>
      </header>

      {/* Quick overview — a glance at how the app is doing, not a full
          analytics dashboard. Total shows/episodes come from data already
          loaded for the list below; watching-now reuses the same
          Realtime Presence count shown on the public home screen. */}
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-3 px-4 pt-4 sm:grid-cols-4 sm:px-8">
        {[
          { label: 'Shows', value: shows.length },
          { label: 'Episodes', value: shows.reduce((sum, s) => sum + s.episodes.length, 0) },
          { label: 'Watching now', value: watchingNow },
          { label: "Watched today", value: watchesToday ?? '—' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-2xl font-black text-white">{stat.value}</p>
            <p className="text-xs text-white/40">{stat.label}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="mx-auto max-w-[1200px] px-4 pt-4 sm:px-8">
          <div className="flex items-center gap-2 rounded-xl border border-[#FF6B60]/30 bg-[#FF6B60]/10 px-4 py-3 text-sm text-[#FF6B60]">
            <X className="h-4 w-4 shrink-0" />
            {error}
            <button onClick={() => setError('')} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Continue Posting — the fast path for "what needs a new episode
          today". Ranked oldest-last-episode-first so the series that's
          gone quietest floats to the top. Tapping a card jumps straight
          to that show, expanded, with the Add Episode form already open
          and pre-filled with the next episode number/season. */}
      {!loading && !search.trim() && continuePostingShows.length > 0 && (
        <div className="mx-auto max-w-[1200px] px-4 pt-6 sm:px-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white/70">
            <Video className="h-4 w-4 text-[#2050D8]" /> Continue posting
          </h2>
          <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
            {continuePostingShows.map((show) => {
              const nextNumber =
                show.episodes.reduce((max, ep) => Math.max(max, ep.episode_number), 0) + 1;
              return (
                <button
                  key={show.id}
                  onClick={() => openAddEpisodeFor(show)}
                  className="flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-[#0E1017] p-2.5 text-left transition hover:border-[#2050D8]/40 hover:bg-white/[0.03]"
                  style={{ width: 220 }}
                >
                  <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-[#151926]">
                    {show.poster_url && (
                      <img src={show.poster_url} alt={show.title} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-white">{show.title}</p>
                    <p className="mt-0.5 text-[11px] text-white/40">
                      {show.episodes.length} ep{show.episodes.length === 1 ? '' : 's'} so far
                    </p>
                    <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-[#2050D8]/15 px-2 py-[2px] text-[11px] font-bold text-[#93B2FF]">
                      <Plus className="h-2.5 w-2.5" /> Ep {nextNumber}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#2FD98C]" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {filteredShows.map((show) => {
              const nextNumber =
                show.episodes.reduce((max, ep) => Math.max(max, ep.episode_number), 0) + 1;
              const withVideo = show.episodes.filter((ep) => ep.video_url).length;
              const unlocked = show.episodes.filter((ep) => ep.is_free_preview).length;
              return (
                <button
                  key={show.id}
                  onClick={() => setFocusedShowId(show.id)}
                  className="flex w-full items-center gap-4 rounded-xl border border-white/10 bg-[#0E1017] p-3.5 text-left transition hover:border-[#2FD98C]/40 hover:bg-white/[0.03]"
                >
                  <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-[#151926]">
                    {show.poster_url && (
                      <img src={show.poster_url} alt={show.title} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-bold text-white">{show.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50">
                      <span className="flex items-center gap-1">
                        {show.type === 'movie' ? <Film className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}
                        {show.type === 'movie' ? 'Movie' : 'Series'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Video className="h-3.5 w-3.5" />
                        {show.episodes.length} ep{show.episodes.length === 1 ? '' : 's'}
                      </span>
                      {show.episodes.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Crown className="h-3.5 w-3.5 text-[#F5C563]" />
                          {unlocked}/{show.episodes.length} unlocked
                        </span>
                      )}
                    </div>
                    {/* The gap that actually costs money: an episode row
                        exists but no video is attached, so viewers see a
                        listing that will not play. Surfaced on the card
                        so it is visible without opening the show. */}
                    {show.episodes.length > withVideo && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-[#F5C563]/12 px-2 py-[2px] text-[11px] font-bold text-[#F5C563]">
                        <Clock className="h-2.5 w-2.5" />
                        {show.episodes.length - withVideo} without video
                      </p>
                    )}
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 sm:flex">
                    <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/60">
                      {show.type === 'movie' ? 'Open' : `Next: Ep ${nextNumber}`}
                    </span>
                    <ChevronRight className="h-4 w-4 text-white/30" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>


      {/* ============ Full-screen show workspace ============
          One show owns the screen: its poster and stats up top, a
          sticky action bar, then its episodes. Everything that used to
          be buried inside an accordion row is now the whole page, so
          adding an episode is not a scrolling exercise. */}
      {focusedShow && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-app">
          <header className="sticky top-0 z-10 shrink-0 border-b border-white/10 bar-blur">
            <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-4 py-3.5 sm:px-8">
              <button
                onClick={() => {
                  setFocusedShowId(null);
                  setAddEpOpen(null);
                  setPasteUrlFor(null);
                }}
                className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">All shows</span>
              </button>
              <div className="h-10 w-7 shrink-0 overflow-hidden rounded-md bg-[#151926]">
                {focusedShow.poster_url && (
                  <img src={focusedShow.poster_url} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold text-white sm:text-base">{focusedShow.title}</h2>
                <p className="truncate text-[11px] text-white/40">
                  {focusedShow.type === 'movie' ? 'Movie' : 'Series'} · {focusedShow.episodes.length} ep
                  {focusedShow.episodes.length === 1 ? '' : 's'}
                </p>
              </div>
              <button
                onClick={() => openEdit(focusedShow)}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Edit show</span>
              </button>
              {(focusedShow.type !== 'movie' || focusedShow.episodes.length === 0) && (
                <button
                  onClick={() => openAddEpisodeFor(focusedShow)}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#2FD98C] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[#2B9A67]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {focusedShow.type === 'movie' ? 'Add video slot' : `Add Ep ${nextEpisodeNumber}`}
                  </span>
                </button>
              )}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1100px] px-4 py-5 sm:px-8">
              {/* At-a-glance state of this focusedShow. "Missing video" is the
                  one that matters — those rows are visible to viewers
                  and will not play. */}
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Episodes', value: focusedShow.episodes.length, tone: 'text-white' },
                  {
                    label: 'Video ready',
                    value: focusedShow.episodes.filter((ep) => ep.video_url).length,
                    tone: 'text-[#2FD98C]',
                  },
                  {
                    label: 'Missing video',
                    value: focusedShow.episodes.filter((ep) => !ep.video_url).length,
                    tone: focusedShow.episodes.some((ep) => !ep.video_url) ? 'text-[#F5C563]' : 'text-white/40',
                  },
                  {
                    label: 'Unlocked (free)',
                    value: focusedShow.episodes.filter((ep) => ep.is_free_preview).length,
                    tone: 'text-white',
                  },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className={`text-2xl font-black ${stat.tone}`}>{stat.value}</p>
                    <p className="text-xs text-white/40">{stat.label}</p>
                  </div>
                ))}
              </div>

              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white/70">
                <ListVideo className="h-4 w-4 text-[#2FD98C]" /> Episodes &amp; video
              </h3>

              <div ref={addEpisodeRef}>
            {/* Bulk unlock/lock — every episode is VIP-locked by default,
                this is the fast path for "unlock this whole show" instead
                of tapping Unlock on each episode one at a time. */}
            {focusedShow.episodes.length > 0 && (
              <div className="mb-3 flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-white/50">
                  <Crown className="h-3.5 w-3.5 text-[#F5C563]" />
                  {focusedShow.episodes.filter((ep) => ep.is_free_preview).length}/{focusedShow.episodes.length} unlocked
                </span>
                <button
                  onClick={() =>
                    handleBulkSetEpisodesFree(
                      focusedShow.id,
                      focusedShow.episodes.map((ep) => ep.id),
                      true,
                    )
                  }
                  disabled={bulkLockBusyShowId === focusedShow.id}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-[#2FD98C]/30 bg-[#2FD98C]/10 px-3 py-1.5 text-xs font-semibold text-[#2FD98C] transition hover:bg-[#2FD98C]/20 disabled:opacity-50"
                >
                  {bulkLockBusyShowId === focusedShow.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5" />
                  )}
                  Unlock all
                </button>
                <button
                  onClick={() =>
                    handleBulkSetEpisodesFree(
                      focusedShow.id,
                      focusedShow.episodes.map((ep) => ep.id),
                      false,
                    )
                  }
                  disabled={bulkLockBusyShowId === focusedShow.id}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-50"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Lock all
                </button>
              </div>
            )}
            <div className="space-y-3">
              {focusedShow.episodes.map((ep) => {
                const hasVideo = !!ep.video_url;
                const isUploading = uploadingFor === ep.id;
                return (
                  <div
                    key={ep.id}
                    className="rounded-xl border border-white/5 bg-[#151926] p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-sm font-bold text-white/60">
                        {ep.episode_number}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">
                          {ep.title}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2 text-xs">
                          {hasVideo ? (
                            <span className="flex items-center gap-1 text-[#2FD98C]">
                              <CheckCircle2 className="h-3 w-3" /> Video ready
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[#F5C563]">
                              <Clock className="h-3 w-3" /> No video uploaded
                            </span>
                          )}
                          {ep.duration && (
                            <span className="text-white/40">
                              · {ep.duration} min
                            </span>
                          )}
                        </div>
                        {isUploading && (
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-[#2FD98C] transition-all"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                        )}
                      </div>
                      {hasVideo && (
                        <button
                          onClick={() => handlePreviewVideo(ep.id)}
                          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Preview
                        </button>
                      )}
                      {/* Per-episode free-preview toggle — episodes are locked
                          (VIP-only) by default, this is the one-tap way to make
                          a single episode playable without a subscription. */}
                      <button
                        onClick={() => handleToggleEpisodeFree(ep)}
                        disabled={episodeLockBusyId === ep.id}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                          ep.is_free_preview
                            ? 'border-[#2FD98C]/40 bg-[#2FD98C]/10 text-[#2FD98C] hover:bg-[#2FD98C]/20'
                            : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                        }`}
                        title={ep.is_free_preview ? 'Unlocked — tap to lock again' : 'Locked — tap to unlock (playable without VIP)'}
                      >
                        {episodeLockBusyId === ep.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : ep.is_free_preview ? (
                          <Unlock className="h-3.5 w-3.5" />
                        ) : (
                          <Lock className="h-3.5 w-3.5" />
                        )}
                        {ep.is_free_preview ? 'Unlocked' : 'Locked'}
                      </button>
                      <button
                        onClick={() => triggerFileUpload(ep.id)}
                        disabled={isUploading}
                        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
                      >
                        {isUploading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        {hasVideo ? 'Replace' : 'Upload'}
                      </button>
                      <button
                        onClick={() => {
                          if (pasteUrlFor === ep.id) {
                            setPasteUrlFor(null);
                            setPasteUrlValue('');
                          } else {
                            setPasteUrlFor(ep.id);
                            setPasteUrlValue(ep.video_url ?? '');
                          }
                        }}
                        className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-white/50 underline-offset-2 transition hover:text-white hover:underline"
                      >
                        <Link2 className="h-3.5 w-3.5" /> Paste URL
                      </button>
                      <button
                        onClick={() => handleDeleteEpisode(ep.id)}
                        className="rounded-lg p-2 text-white/40 transition hover:bg-[#FF6B60]/10 hover:text-[#FF6B60]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {pasteUrlFor === ep.id && (
                      <div className="mt-2.5 flex items-center gap-2 border-t border-white/5 pt-2.5">
                        <input
                          type="text"
                          value={pasteUrlValue}
                          onChange={(e) => setPasteUrlValue(e.target.value)}
                          placeholder="https://.../episode.mp4 or .m3u8"
                          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-white outline-none"
                        />
                        <button
                          onClick={() => handleSaveVideoUrl(ep.id)}
                          disabled={savingUrlFor === ep.id || !pasteUrlValue.trim()}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#2FD98C] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#4C6FFF] disabled:opacity-50"
                        >
                          {savingUrlFor === ep.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setPasteUrlFor(null);
                            setPasteUrlValue('');
                          }}
                          className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/5"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add episode / video */}
            {(focusedShow.type !== 'movie' || focusedShow.episodes.length === 0) && (
              <div className="mt-4">
                {addEpOpen === focusedShow.id ? (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-[#151926] p-4">
                    {focusedShow.type !== 'movie' && (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-white/60">
                          Episode #
                        </label>
                        <input
                          type="number"
                          value={newEp.episode_number}
                          onChange={(e) =>
                            setNewEp({ ...newEp, episode_number: e.target.value })
                          }
                          placeholder="1"
                          className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-white/60">
                          Season
                        </label>
                        <input
                          type="number"
                          value={newEp.season}
                          onChange={(e) =>
                            setNewEp({ ...newEp, season: e.target.value })
                          }
                          className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-white/60">
                          Duration (min) — auto
                        </label>
                        <input
                          type="number"
                          value={newEp.duration}
                          onChange={(e) =>
                            setNewEp({ ...newEp, duration: e.target.value })
                          }
                          placeholder="Leave blank — read from video"
                          className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none placeholder:text-[11px]"
                        />
                      </div>
                    </div>
                    )}
                    {focusedShow.type === 'movie' && (
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-white/60">
                          Duration (min) — auto
                        </label>
                        <input
                          type="number"
                          value={newEp.duration}
                          onChange={(e) =>
                            setNewEp({ ...newEp, duration: e.target.value })
                          }
                          placeholder="Leave blank — read from video"
                          className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none placeholder:text-[11px]"
                        />
                      </div>
                    )}
                    {focusedShow.type !== 'movie' && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-white/60">
                        Title
                      </label>
                      <input
                        value={newEp.title}
                        onChange={(e) =>
                          setNewEp({ ...newEp, title: e.target.value })
                        }
                        placeholder="Episode title"
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                      />
                    </div>
                    )}
                    {focusedShow.type !== 'movie' && (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-white/60">
                        Description
                      </label>
                      <textarea
                        value={newEp.description}
                        onChange={(e) =>
                          setNewEp({ ...newEp, description: e.target.value })
                        }
                        rows={2}
                        className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                      />
                    </div>
                    )}
                    <div>
                      <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-white/60">
                        <Link2 className="h-3 w-3" /> Video URL (optional — paste now or add later)
                      </label>
                      <input
                        value={newEp.video_url}
                        onChange={(e) =>
                          setNewEp({ ...newEp, video_url: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddEpisode(
                              focusedShow.id,
                              focusedShow.type === 'movie' ? focusedShow.title : undefined,
                            );
                          }
                        }}
                        placeholder="https://…  (paste link, press Enter or Add to save + jump to next ep)"
                        className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none focus:border-[#2FD98C]/50"
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          handleAddEpisode(
                            focusedShow.id,
                            focusedShow.type === 'movie' ? focusedShow.title : undefined,
                          )
                        }
                        disabled={busy}
                        className="flex items-center gap-1.5 rounded-lg bg-[#2FD98C] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#4C6FFF] disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        {focusedShow.type === 'movie' ? 'Add Movie Slot' : `Add Ep ${newEp.episode_number || ''} & Next`}
                      </button>
                      <button
                        onClick={() => setAddEpOpen(null)}
                        className="rounded-lg border border-white/10 px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/5"
                      >
                        {focusedShow.type === 'movie' ? 'Cancel' : 'Done'}
                      </button>
                    </div>
                    {focusedShow.type !== 'movie' && (
                      <p className="text-[11px] text-white/35">
                        Tip: paste the link, hit Enter — it saves this episode and jumps straight to the next number so you can paste again.
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => openAddEpisodeFor(focusedShow)}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 px-4 py-2.5 text-xs font-semibold text-white/60 transition hover:border-[#2FD98C]/40 hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {focusedShow.type === 'movie' ? 'Add Movie Video Slot' : 'Add Episode'}
                  </button>
                )}
              </div>
            )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Show modal */}
      {addShowOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-[#0E1017] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">New Show / Movie</h2>
              <button
                onClick={() => setAddShowOpen(false)}
                className="rounded-lg p-1.5 text-white/50 hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-white/60">Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setNewShow({ ...newShow, type: 'series' })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${
                      newShow.type === 'series'
                        ? 'border-[#2FD98C]/50 bg-[#2FD98C]/10 text-white'
                        : 'border-white/10 bg-white/5 text-white/60'
                    }`}
                  >
                    Series
                  </button>
                  <button
                    onClick={() => setNewShow({ ...newShow, type: 'movie' })}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${
                      newShow.type === 'movie'
                        ? 'border-[#2FD98C]/50 bg-[#2FD98C]/10 text-white'
                        : 'border-white/10 bg-white/5 text-white/60'
                    }`}
                  >
                    Movie
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-white/60">Title *</label>
                <input
                  value={newShow.title}
                  onChange={(e) => setNewShow({ ...newShow, title: e.target.value })}
                  placeholder="Show or movie title"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-white/60">Synopsis</label>
                <textarea
                  value={newShow.synopsis}
                  onChange={(e) => setNewShow({ ...newShow, synopsis: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-white/60">Release year</label>
                  <input
                    type="number"
                    value={newShow.release_year}
                    onChange={(e) => setNewShow({ ...newShow, release_year: e.target.value })}
                    placeholder="2026"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-white/60">Studio</label>
                  <input
                    value={newShow.studio}
                    onChange={(e) => setNewShow({ ...newShow, studio: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-white/60">
                  Poster (vertical card image)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setPosterFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1 file:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-white/60">
                  Banner (wide hero image)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setBannerFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1 file:text-white"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={newShow.featured}
                  onChange={(e) => setNewShow({ ...newShow, featured: e.target.checked })}
                />
                Feature on home hero carousel
              </label>

              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={newShow.coming_soon}
                  onChange={(e) => setNewShow({ ...newShow, coming_soon: e.target.checked })}
                />
                Coming Soon (has a poster/banner but no episodes yet — shows in its own row, not the normal rails)
              </label>

              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={newShow.is_free}
                  onChange={(e) => setNewShow({ ...newShow, is_free: e.target.checked })}
                />
                Free to watch (no VIP required — shows a FREE badge instead of the VIP crown)
              </label>
              <p className="-mt-2 pl-6 text-[11px] text-white/40">
                Every episode is still VIP-locked by default even on a free show — unlock the
                episodes you want playable from the episode list below (or use "Unlock all").
              </p>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleCreateShow}
                  disabled={creatingShow}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#2FD98C] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#4C6FFF] disabled:opacity-50"
                >
                  {creatingShow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create
                </button>
                <button
                  onClick={() => setAddShowOpen(false)}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-white/40">
                After creating, expand the show below to upload its episode(s)/video file.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Edit Show modal */}
      {editShow && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-[#0E1017] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Edit Show</h2>
              <button
                onClick={() => setEditShow(null)}
                className="rounded-lg p-1.5 text-white/50 hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-white/60">Title *</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Show or movie title"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-white/60">Synopsis</label>
                <textarea
                  value={editSynopsis}
                  onChange={(e) => setEditSynopsis(e.target.value)}
                  rows={4}
                  placeholder="Short description shown on the show's detail page"
                  className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-white/60">
                    Rating (0–10)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={editRating}
                    onChange={(e) => setEditRating(e.target.value)}
                    placeholder="8.5"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-white/60">
                    View count (auto-tracked — edit only to seed/adjust)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editViewCount}
                    onChange={(e) => setEditViewCount(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={editComingSoon}
                  onChange={(e) => setEditComingSoon(e.target.checked)}
                />
                Coming Soon (has a poster/banner but no episodes yet — shows in its own row, not the normal rails)
              </label>

              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={editIsFree}
                  onChange={(e) => setEditIsFree(e.target.checked)}
                />
                Free to watch (no VIP required — shows a FREE badge instead of the VIP crown)
              </label>

              {/* Current images preview */}
              <div className="flex gap-3">
                {editShow.poster_url && (
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-semibold text-white/60">Current poster</label>
                    <img
                      src={editShow.poster_url}
                      alt="Poster"
                      className="h-24 w-16 rounded-lg object-cover ring-1 ring-white/10"
                    />
                  </div>
                )}
                {editShow.banner_url && (
                  <div className="flex-1">
                    <label className="mb-1 block text-[11px] font-semibold text-white/60">Current banner</label>
                    <img
                      src={editShow.banner_url}
                      alt="Banner"
                      className="h-24 w-40 rounded-lg object-cover ring-1 ring-white/10"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-white/60">
                  Replace poster (vertical card image)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setEditPosterFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1 file:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-white/60">
                  Replace banner (wide hero image)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setEditBannerFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-2.5 file:py-1 file:text-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#2FD98C] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#4C6FFF] disabled:opacity-50"
                >
                  {editSuccess ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : savingEdit ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {editSuccess ? 'Saved!' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setEditShow(null)}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-white/70 transition hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin video preview modal */}
      {previewFor && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4"
          onClick={closePreview}
        >
          <div
            className="relative w-full max-w-3xl overflow-hidden rounded-xl bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closePreview}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex aspect-video items-center justify-center bg-black">
              {previewLoading && <Loader2 className="h-8 w-8 animate-spin text-white/60" />}
              {!previewLoading && previewError && (
                <p className="px-6 text-center text-sm text-[#FF6B60]">{previewError}</p>
              )}
              {!previewLoading && previewUrl && (
                <video src={previewUrl} controls autoPlay className="h-full w-full" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input — single instance, target set via pendingUploadId */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.m3u8"
        className="hidden"
        onChange={handleFileSelected}
      />

      {announcementsOpen && <AnnouncementsPanel onClose={() => setAnnouncementsOpen(false)} />}
      {banLogOpen && <BanLogPanel onClose={() => setBanLogOpen(false)} />}
      {watchLogOpen && <WatchLogPanel onClose={() => setWatchLogOpen(false)} />}
      {paymentsOpen && <PaymentsPanel onClose={() => setPaymentsOpen(false)} />}
      {subscriptionsOpen && <SubscriptionsPanel onClose={() => setSubscriptionsOpen(false)} />}
      {usersOpen && <UsersPanel onClose={() => setUsersOpen(false)} />}
      {suspiciousOpen && <SuspiciousActivityPanel onClose={() => setSuspiciousOpen(false)} />}
    </div>
  );
}
