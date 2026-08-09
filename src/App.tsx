import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/supabaseClient';
import { fetchProfile, type Profile } from '@/lib/auth';
import { fetchShowById, fetchEpisodesByShow } from '@/lib/api';
import type { Show, ShowWithGenres, Episode } from '@/lib/types';
import { addToContinueWatching } from '@/lib/watchlist';
import AuthScreen from '@/components/AuthScreen';
import HomeScreen, { type Tab } from '@/components/HomeScreen';
import ShowDetailScreen from '@/components/ShowDetailScreen';
import VideoPlayerScreen from '@/components/VideoPlayerScreen';
import WatchlistScreen from '@/components/WatchlistScreen';
import AdminScreen from '@/components/AdminScreen';
import DesktopBlockedScreen from '@/components/DesktopBlockedScreen';
import LuckyDrawModal from '@/components/LuckyDrawModal';
import AnnouncementBanner from '@/components/AnnouncementBanner';
import SupporterTicker from '@/components/SupporterTicker';
import CreatorCredit from '@/components/CreatorCredit';
import { useIsMobile } from '@/lib/useIsMobile';
import { initTelegramApp, isInTelegram, registerBackButtonHandler, unregisterBackButtonHandler, showBackButton, hideBackButton, getStartParam, hapticTap, hapticSuccess } from '@/lib/telegram';

// This build is the Telegram VIP Mini App: access is already gated by
// Telegram group membership (a separate admin bot bans/kicks non-members),
// so there is no viewer sign-in/sign-up and no subscription lock — every
// episode plays freely for anyone who opens the app. The only login left
// is the existing admin sign-in, desktop-only, for content management.
type Screen =
  | { name: 'auth'; mode: 'signin' | 'signup' }
  | { name: 'home' }
  | { name: 'detail'; show: Show }
  | { name: 'player'; episode: Episode; show: ShowWithGenres }
  | { name: 'watchlist' }
  | { name: 'admin' };

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showSpin, setShowSpin] = useState(false);
  const isMobile = useIsMobile();
  // Anyone opening the Mini App from inside Telegram — phone OR the
  // Telegram Desktop app — should always land in the viewer experience,
  // regardless of window width. Width alone used to gate this, which
  // wrongly blocked members using Telegram Desktop (a wide viewport just
  // like a browser). isMobile stays as a fallback so testing in a plain
  // narrow browser window still works during development.
  const isViewerContext = isMobile || isInTelegram();
  const isAdmin = !!profile?.is_admin;

  // Tell Telegram the app is ready + expand to full height. Also resolve
  // a deep link: a group message linking to https://t.me/Bot/app?startapp=show_<id>
  // opens straight to that show instead of the home screen.
  useEffect(() => {
    initTelegramApp();
    const startParam = getStartParam();
    if (startParam?.startsWith('show_')) {
      const showId = startParam.slice('show_'.length);
      fetchShowById(showId).then((show) => {
        if (show) setScreen({ name: 'detail', show });
      });
    }
  }, []);

  // Telegram Mini Apps have no browser chrome, so there's no native back
  // arrow — Telegram gives us a BackButton bound to one callback instead.
  // Keep a ref to "what back means right now" so we register the click
  // handler once and just update what it points to as the screen changes.
  const backTargetRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handleBack = () => backTargetRef.current();
    registerBackButtonHandler(handleBack);
    return () => unregisterBackButtonHandler(handleBack);
  }, []);

  useEffect(() => {
    if (screen.name === 'home') {
      backTargetRef.current = () => {};
      hideBackButton();
      return;
    }
    if (screen.name === 'player') {
      backTargetRef.current = () => setScreen({ name: 'detail', show: screen.show });
    } else {
      backTargetRef.current = () => setScreen({ name: 'home' });
    }
    showBackButton();
  }, [screen]);

  // Admin session bootstrap only. Viewers never sign in, so there is
  // nothing to restore for them.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) {
        const p = await fetchProfile(data.session.user.id);
        setProfile(p);
      }
      setAuthReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      (async () => {
        setSession(sess);
        if (sess?.user) {
          const p = await fetchProfile(sess.user.id);
          setProfile(p);
        } else {
          setProfile(null);
        }
      })();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Login succeeded, but `profile` (and therefore isAdmin) hasn't caught
  // up yet — it loads asynchronously from the auth-state-change listener
  // above. Jumping straight to the 'admin' screen here used to close the
  // auth form before isAdmin flipped true, which made the gate's
  // "!isViewerContext && !isAdmin" check re-trigger and bounce back to
  // the blocked/login screen. Instead, just wait — the effect below moves
  // to 'admin' itself the moment isAdmin actually becomes true.
  const handleAdminAuthSuccess = () => {};

  useEffect(() => {
    if (!isViewerContext && isAdmin && screen.name !== 'admin') {
      setScreen({ name: 'admin' });
    }
  }, [isViewerContext, isAdmin, screen.name]);

  // Every episode is free to play — access is gated at the Telegram group
  // level, not inside the app.
  const handlePlayEpisode = (episode: Episode, show: ShowWithGenres) => {
    hapticTap();
    addToContinueWatching(show, episode, episode.episode_number - 1);
    setScreen({ name: 'player', episode, show });
  };

  // Resume a continue-watching item: fetch fresh show detail + episodes,
  // then jump to the remembered episode.
  const handleResumeEpisode = async (show: Show, episodeId: string) => {
    const [detail, eps] = await Promise.all([
      fetchShowById(show.id),
      fetchEpisodesByShow(show.id),
    ]);
    const ep = eps.find((e) => e.id === episodeId);
    if (detail && ep) {
      handlePlayEpisode(ep, detail);
    } else if (detail) {
      setScreen({ name: 'detail', show });
    } else {
      setScreen({ name: 'detail', show });
    }
  };

  // Keep activeTab roughly in sync with the screen so the bottom nav
  // highlights the right icon when we navigate away from home and back.
  useEffect(() => {
    if (screen.name === 'home') setActiveTab('home');
    else if (screen.name === 'watchlist') setActiveTab('watchlist');
  }, [screen.name]);

  if (!authReady) {
    return <div className="min-h-screen bg-[#0A0605]" />;
  }

  // The gate is admin-only. Anyone inside Telegram (phone or Telegram
  // Desktop) — or just testing in a narrow browser window — lands
  // straight in the viewer app below. No gate, no login.
  if (!isViewerContext && !isAdmin) {
    return (
      <DesktopBlockedScreen
        authOpen={screen.name === 'auth'}
        onOpenAdminSignIn={() => setScreen({ name: 'auth', mode: 'signin' })}
      >
        <AuthScreen
          mode={screen.name === 'auth' ? screen.mode : 'signin'}
          onBack={() => setScreen({ name: 'home' })}
          onSuccess={handleAdminAuthSuccess}
          onSwitch={(mode) => setScreen({ name: 'auth', mode })}
          kickedOut={false}
        />
      </DesktopBlockedScreen>
    );
  }

  if (screen.name === 'admin') {
    if (!profile?.is_admin) return null;
    return <AdminScreen onBack={() => setScreen({ name: 'home' })} />;
  }

  if (screen.name === 'watchlist') {
    return (
      <WatchlistScreen
        onSelectShow={(show) => setScreen({ name: 'detail', show })}
        onBack={() => setScreen({ name: 'home' })}
        onResumeEpisode={handleResumeEpisode}
      />
    );
  }

  if (screen.name === 'detail') {
    return (
      <ShowDetailScreen
        show={screen.show}
        onBack={() => setScreen({ name: 'home' })}
        onPlayEpisode={handlePlayEpisode}
        subscribed
      />
    );
  }

  if (screen.name === 'player') {
    return (
      <VideoPlayerScreen
        episode={screen.episode}
        show={screen.show}
        onBack={() => setScreen({ name: 'detail', show: screen.show })}
      />
    );
  }

  // home — default and only real landing screen for viewers, no account
  // needed, everything unlocked. The gift badge opens the free lucky
  // spin — available to anyone, once per day, no payment.
  return (
    <>
      <SupporterTicker />
      <AnnouncementBanner />
      <CreatorCredit />
      <HomeScreen
        onSelectShow={(show) => setScreen({ name: 'detail', show })}
        onOpenProfile={() => {}}
        onOpenSubscription={() => {}}
        onOpenWatchlist={() => setScreen({ name: 'watchlist' })}
        onOpenRewards={() => setShowSpin(true)}
        avatarUrl={null}
        subscribed
        rewardsAvailable="spin-ready"
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
      />
      {showSpin && (
        <LuckyDrawModal
          onClose={() => setShowSpin(false)}
          onClaimed={() => hapticSuccess()}
        />
      )}
    </>
  );
}

export default App;
