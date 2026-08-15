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
import LegalScreen from '@/components/LegalScreen';
import AccountScreen from '@/components/AccountScreen';
import VideoPlayerScreen from '@/components/VideoPlayerScreen';
import WatchlistScreen from '@/components/WatchlistScreen';
import AdminScreen from '@/components/AdminScreen';
import DesktopBlockedScreen from '@/components/DesktopBlockedScreen';
import LuckyDrawModal from '@/components/LuckyDrawModal';
import SubscriptionModal from '@/components/SubscriptionModal';
import AnnouncementBanner from '@/components/AnnouncementBanner';
import { useIsMobile } from '@/lib/useIsMobile';
import { getSubscriptionStatus } from '@/lib/subscription';
import { getAvailableBonusSpin } from '@/lib/spin';
import { recordReferralIfPresent } from '@/lib/referral';
import { initTelegramApp, isInTelegram, registerBackButtonHandler, unregisterBackButtonHandler, showBackButton, hideBackButton, getStartParam, hapticTap, hapticSuccess } from '@/lib/telegram';

// This build is the Telegram VIP Mini App: the app itself opens for
// everyone, no group-join check and no viewer sign-in/sign-up required.
// Free shows/episodes (is_free / is_free_preview) play for anyone; a VIP
// subscription (paid via KHQR screenshot, reviewed by the admin) is the
// only thing gating everything else. Everyone is identified by their
// Telegram id, and subscriptions are keyed to that. The only login left
// is the existing admin sign-in, desktop-only, for content management
// and payment review.
type Screen =
  | { name: 'auth'; mode: 'signin' | 'signup' }
  | { name: 'home' }
  | { name: 'detail'; show: Show }
  | { name: 'player'; episode: Episode; show: ShowWithGenres }
  | { name: 'watchlist' }
  | { name: 'legal' }
  | { name: 'account' }
  | { name: 'admin' };

function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showSpin, setShowSpin] = useState(false);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [bonusSpinReady, setBonusSpinReady] = useState(false);
  const refreshSubscription = () => {
    getSubscriptionStatus().then((s) => setSubscribed(s.subscribed));
    getAvailableBonusSpin().then((info) => setBonusSpinReady(!!info));
  };
  useEffect(() => {
    refreshSubscription();
  }, []);
  const isMobile = useIsMobile();
  const isAdmin = !!profile?.is_admin;
  // Testing override: ?admin=1 forces the admin gate on regardless of screen
  // width, so the admin sign-in screen can be reached from Bolt's mobile preview.
  const adminOverride =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('admin') === '1';

  // Tell Telegram the app is ready + expand to full height. Also resolve
  // a deep link: a group message linking to https://t.me/Bot/app?startapp=show_<id>
  // opens straight to that show instead of the home screen. A personal
  // referral link (?startapp=ref_<telegram_id>, see lib/referral.ts and
  // AccountScreen's "Invite & Earn" card) instead tags this viewer as
  // referred by that person — it doesn't change what screen they land on.
  useEffect(() => {
    initTelegramApp();
    const startParam = getStartParam();
    if (startParam?.startsWith('show_')) {
      const showId = startParam.slice('show_'.length);
      fetchShowById(showId).then((show) => {
        if (show) setScreen({ name: 'detail', show });
      });
    } else if (startParam?.startsWith('ref_')) {
      const referrerId = startParam.slice('ref_'.length);
      recordReferralIfPresent(referrerId);
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

  const handleAdminAuthSuccess = () => {
    setScreen({ name: 'admin' });
  };

  // Episodes marked is_free_preview, or shows marked is_free, play for
  // everyone. Everything else needs an active subscription — otherwise
  // this opens the subscribe sheet instead of playing.
  const handlePlayEpisode = (episode: Episode, show: ShowWithGenres) => {
    const free = show.is_free || episode.is_free_preview;
    if (!free && !subscribed) {
      setShowSubscribe(true);
      return;
    }
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

  // Keep activeTab roughly in sync with the screen so it's ready if any
  // header nav state ever needs it when we navigate away from home and back.
  useEffect(() => {
    if (screen.name === 'home') setActiveTab('home');
    else if (screen.name === 'watchlist') setActiveTab('watchlist');
  }, [screen.name]);

  if (!authReady) {
    return <div className="min-h-screen bg-[#0A0A0D]" />;
  }

  // Desktop is admin-only. On mobile (the real Telegram Mini App surface)
  // everyone lands straight in the viewer app below — no gate, no login.
  // Being genuinely inside Telegram (even the Desktop client, which can
  // report a wide viewport) also skips the gate entirely, so a wide
  // Telegram window should never get shown the "open on your phone" QR
  // screen. The adminOverride (?admin=1) forces the gate on for testing
  // in Bolt's plain-browser mobile preview — it never applies once we're
  // actually inside Telegram.
  const inTelegramClient = isInTelegram();
  const showDesktopGate = !inTelegramClient && (!isMobile || adminOverride);
  if (showDesktopGate && !isAdmin) {
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

  // Reachable from mobile via the hidden 5-tap logo gesture on the
  // Account screen (see AccountScreen's onAdminSecretTap) — the desktop
  // gate above never fires on mobile/Telegram, so without this branch
  // there'd be no way to land on the sign-in screen at all outside of
  // desktop.
  if (screen.name === 'auth') {
    return (
      <AuthScreen
        mode={screen.mode}
        onBack={() => setScreen({ name: 'home' })}
        onSuccess={handleAdminAuthSuccess}
        onSwitch={(mode) => setScreen({ name: 'auth', mode })}
        kickedOut={false}
      />
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

  if (screen.name === 'legal') {
    return <LegalScreen onBack={() => setScreen({ name: 'home' })} />;
  }

  if (screen.name === 'account') {
    return (
      <>
        <AccountScreen
          onBack={() => setScreen({ name: 'home' })}
          onOpenWatchlist={() => setScreen({ name: 'watchlist' })}
          onOpenSubscription={() => setShowSubscribe(true)}
          onOpenSpin={() => setShowSpin(true)}
          onOpenLegal={() => setScreen({ name: 'legal' })}
          onAdminSecretTap={() => setScreen({ name: 'auth', mode: 'signin' })}
        />
        {showSpin && (
          <LuckyDrawModal
            onClose={() => setShowSpin(false)}
            onClaimed={() => hapticSuccess()}
          />
        )}
        {showSubscribe && (
          <SubscriptionModal
            onClose={() => setShowSubscribe(false)}
            onSubmitted={() => {
              hapticSuccess();
              refreshSubscription();
            }}
            onApproved={() => {
              hapticSuccess();
              refreshSubscription();
            }}
            onGoSpin={() => {
              setShowSubscribe(false);
              setShowSpin(true);
            }}
          />
        )}
      </>
    );
  }

  if (screen.name === 'detail') {
    return (
      <>
        <ShowDetailScreen
          show={screen.show}
          onBack={() => setScreen({ name: 'home' })}
          onPlayEpisode={handlePlayEpisode}
          onSelectShow={(s) => setScreen({ name: 'detail', show: s })}
          subscribed={subscribed}
        />
        {showSubscribe && (
          <SubscriptionModal
            onClose={() => setShowSubscribe(false)}
            onSubmitted={() => {
              hapticSuccess();
              refreshSubscription();
            }}
            onApproved={() => {
              hapticSuccess();
              refreshSubscription();
            }}
            onGoSpin={() => {
              setShowSubscribe(false);
              setShowSpin(true);
            }}
          />
        )}
      </>
    );
  }

  if (screen.name === 'player') {
    return (
      <VideoPlayerScreen
        episode={screen.episode}
        show={screen.show}
        onBack={() => setScreen({ name: 'detail', show: screen.show })}
        onSwitchEpisode={(ep) => {
          hapticTap();
          addToContinueWatching(screen.show, ep, ep.episode_number - 1);
          setScreen({ name: 'player', episode: ep, show: screen.show });
        }}
      />
    );
  }

  // home — default and only real landing screen for viewers, no account
  // needed, everything unlocked. The gift badge opens the free lucky
  // spin — available to anyone, once per day, no payment.
  return (
    <>
      <AnnouncementBanner />
      <HomeScreen
        onSelectShow={(show) => setScreen({ name: 'detail', show })}
        onOpenProfile={() => setScreen({ name: 'account' })}
        onOpenSubscription={() => setShowSubscribe(true)}
        onOpenWatchlist={() => setScreen({ name: 'watchlist' })}
        onOpenRewards={() => setShowSpin(true)}
        avatarUrl={null}
        subscribed={subscribed}
        rewardsAvailable={bonusSpinReady ? 'spin-ready' : null}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        onOpenLegal={() => setScreen({ name: 'legal' })}
        onResumeEpisode={handleResumeEpisode}
      />
      {showSpin && (
        <LuckyDrawModal
          onClose={() => setShowSpin(false)}
          onClaimed={() => hapticSuccess()}
        />
      )}
      {showSubscribe && (
        <SubscriptionModal
          onClose={() => setShowSubscribe(false)}
          onSubmitted={() => {
            hapticSuccess();
            refreshSubscription();
          }}
          onApproved={() => {
            hapticSuccess();
            refreshSubscription();
          }}
          onGoSpin={() => {
            setShowSubscribe(false);
            setShowSpin(true);
          }}
        />
      )}
    </>
  );
}

export default App;
