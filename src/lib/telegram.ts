// Thin wrapper around the Telegram Mini App SDK (loaded via the
// telegram-web-app.js script tag in index.html). Every call is guarded
// so the app still works fine when opened in a normal desktop/mobile
// browser (e.g. during development) where window.Telegram is undefined.

interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  initDataUnsafe?: {
    start_param?: string;
    user?: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
      photo_url?: string;
    };
  };
  BackButton: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
  // Mini App-level fullscreen (Bot API 8.0+, ~mid-2024 Telegram clients).
  // This is separate from — and takes priority over — the browser's own
  // Fullscreen API: it expands the whole Mini App to cover Telegram's own
  // header/chrome, which is the only real "fullscreen" available inside
  // Telegram's WebView, since that WebView blocks the standard web
  // Fullscreen API entirely. Optional because older Telegram app versions
  // don't have it — always guard with `?.` before calling.
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  isFullscreen?: boolean;
  // Bot API 7.7+. Without this, Telegram's WebView treats certain
  // vertical scroll/swipe gestures (e.g. rubber-banding at the top of a
  // scrollable screen) as a "swipe down to close" and dismisses the
  // whole Mini App — a common source of "the app just closes while I'm
  // scrolling" reports. Guarded with `?.` for older clients.
  disableVerticalSwipes?: () => void;
  // Opens Telegram's own "forward to a chat" picker for a t.me link —
  // the native way to share something from inside a Mini App, distinct
  // from openLink (which just opens a URL in-app/externally).
  openTelegramLink?: (url: string) => void;
  // Hands a URL to the CLIENT to open, instead of navigating inside the
  // Mini App's own WebView. This is the only way an https link can reach
  // another installed app (see openExternalLink below).
  openLink?: (
    url: string,
    options?: { try_instant_view?: boolean; try_browser?: string },
  ) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

// Call once on app boot: tells Telegram the app is ready to be shown,
// expands it to full height (otherwise it opens as a half-height sheet),
// and turns off Telegram's own vertical-swipe-to-close gesture so
// scrolling near the top/bottom of a screen never accidentally closes
// the whole Mini App.
export function initTelegramApp() {
  const tg = getTelegramWebApp();
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
}

// Returns whether we're actually running inside Telegram (vs a plain
// browser tab during local development).
export function isInTelegram(): boolean {
  return !!getTelegramWebApp();
}

// Mini-App-level fullscreen — the thing that actually works inside
// Telegram's own WebView (see the interface comment above for why the
// browser's Fullscreen API doesn't). No-ops safely on older Telegram
// clients or outside Telegram entirely.
export function enterTelegramFullscreen(): void {
  getTelegramWebApp()?.requestFullscreen?.();
}
export function exitTelegramFullscreen(): void {
  getTelegramWebApp()?.exitFullscreen?.();
}
export function isTelegramFullscreen(): boolean {
  return !!getTelegramWebApp()?.isFullscreen;
}
// Older Telegram client versions don't have requestFullscreen at all —
// this tells the caller whether it's actually safe to rely on the
// Telegram-native path, or whether it should fall back to the browser's
// own Fullscreen API instead (worth trying even inside Telegram, since
// Android's WebView is Chromium-based and sometimes honors it).
export function hasTelegramFullscreenAPI(): boolean {
  return !!getTelegramWebApp()?.requestFullscreen;
}

// Invites a friend to the community group (optional — not required to
// use the app or watch anything). Free shows play for anyone who opens
// the Mini App directly; this is just a way to grow the group itself.
// Needs VITE_TELEGRAM_GROUP_LINK configured; without it this is a no-op.
export async function inviteFriend(): Promise<'shared' | 'copied' | 'failed' | 'not_configured'> {
  const groupLink = import.meta.env.VITE_TELEGRAM_GROUP_LINK as string | undefined;
  if (!groupLink) return 'not_configured';

  const text = 'ចូលរួម NINT ANIME VIP ដើម្បីមើលរឿងចិនកម្សាន្តគ្មានដែនកំណត់!';
  const tg = getTelegramWebApp();
  if (tg?.openTelegramLink) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(groupLink)}&text=${encodeURIComponent(text)}`;
    tg.openTelegramLink(shareUrl);
    return 'shared';
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: text, url: groupLink });
      return 'shared';
    } catch {
      return 'failed';
    }
  }

  try {
    await navigator.clipboard.writeText(groupLink);
    return 'copied';
  } catch {
    return 'failed';
  }
}

// Shares a deep link straight into a specific show
// (t.me/YourBot/app?startapp=show_<id>). Anyone who opens it can watch
// straight away if the show/episode is free; VIP-only episodes still
// open the subscribe sheet instead of playing, same as any other entry
// point. Needs VITE_TELEGRAM_BOT_USERNAME configured (bot username, no
// @); without it, falls back to sharing the current page URL instead of
// a proper deep link.
export async function shareShow(showId: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  const deepLink = botUsername
    ? `https://t.me/${botUsername}/app?startapp=show_${showId}`
    : window.location.href;

  const tg = getTelegramWebApp();
  if (tg?.openTelegramLink) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent(title)}`;
    tg.openTelegramLink(shareUrl);
    return 'shared';
  }

  if (navigator.share) {
    try {
      await navigator.share({ title, url: deepLink });
      return 'shared';
    } catch {
      return 'failed';
    }
  }

  try {
    await navigator.clipboard.writeText(deepLink);
    return 'copied';
  } catch {
    return 'failed';
  }
}

// Builds this viewer's personal referral link
// (t.me/YourBot/app?startapp=ref_<their_telegram_id>). Whoever opens it
// gets tagged as referred by them — see src/lib/referral.ts for what
// happens with that tag. Returns null if we don't actually know who
// this viewer is (not inside Telegram) or VITE_TELEGRAM_BOT_USERNAME
// isn't configured, since a referral link is meaningless without both.
export function getReferralLink(): string | null {
  const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  const user = getCurrentTelegramUser();
  if (!botUsername || !user) return null;
  return `https://t.me/${botUsername}/app?startapp=ref_${user.id}`;
}

// Shares the viewer's referral link with a friend. Unlike inviteFriend
// (which points at the community group) and shareShow (a specific show),
// this is the growth loop tied to the reward in src/lib/referral.ts — so
// unlike those two, it has no clipboard/URL fallback: without a real
// Telegram identity there's no link to build (getReferralLink returns
// null), and sharing "nothing" would silently look like success.
export async function shareReferralLink(): Promise<'shared' | 'copied' | 'failed' | 'not_configured'> {
  const link = getReferralLink();
  if (!link) return 'not_configured';

  const text = 'ចូលរួមទស្សនា Anime HD ភាសាខ្មែរ ជាមួយខ្ញុំនៅ NINT ANIME!';
  const tg = getTelegramWebApp();
  if (tg?.openTelegramLink) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    tg.openTelegramLink(shareUrl);
    return 'shared';
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: text, url: link });
      return 'shared';
    } catch {
      return 'failed';
    }
  }

  try {
    await navigator.clipboard.writeText(link);
    return 'copied';
  } catch {
    return 'failed';
  }
}

// The `start_param` from a deep link like
// https://t.me/YourBot/app?startapp=show_<id> arrives here as "show_<id>".
export function getStartParam(): string | null {
  return getTelegramWebApp()?.initDataUnsafe?.start_param ?? null;
}

// The viewer's own Telegram identity, when opened for real inside
// Telegram — used to stamp a faint watermark on the video player so a
// leaked recording can be traced back to whoever's screen it came from.
// Falls back to null in a plain browser (dev/preview), where no watermark
// is shown at all.
export function getCurrentTelegramUser(): { id: number; label: string } | null {
  const user = getTelegramWebApp()?.initDataUnsafe?.user;
  if (!user) return null;
  return {
    id: user.id,
    label: user.username ? `@${user.username}` : user.first_name ?? String(user.id),
  };
}

// Full Telegram identity for display purposes (Account screen) — name,
// @username, numeric ID, and profile photo when Telegram provides one.
// This is the "you're really signed in as you, no separate account
// needed" proof: showing the same photo/name/ID the person already sees
// on their own Telegram profile is what makes that credible at a glance,
// rather than a generic placeholder avatar that could belong to anyone.
export function getCurrentTelegramProfile(): {
  id: number;
  username: string | null;
  fullName: string | null;
  photoUrl: string | null;
} | null {
  const user = getTelegramWebApp()?.initDataUnsafe?.user;
  if (!user) return null;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || null;
  return {
    id: user.id,
    username: user.username ?? null,
    fullName,
    photoUrl: user.photo_url ?? null,
  };
}

// --- Back button -------------------------------------------------------
// Telegram Mini Apps have no browser chrome, so there is no native back
// arrow — Telegram gives us one via BackButton.show()/hide() bound to a
// single callback. useTelegramBackButton (in App.tsx) shows it whenever
// the screen isn't "home" and wires it to the same onBack handler each
// screen already uses.
export function registerBackButtonHandler(onClick: () => void) {
  getTelegramWebApp()?.BackButton.onClick(onClick);
}

export function unregisterBackButtonHandler(onClick: () => void) {
  getTelegramWebApp()?.BackButton.offClick(onClick);
}

export function showBackButton() {
  getTelegramWebApp()?.BackButton.show();
}

export function hideBackButton() {
  getTelegramWebApp()?.BackButton.hide();
}

// --- Haptics -------------------------------------------------------------
export function hapticTap() {
  getTelegramWebApp()?.HapticFeedback.impactOccurred('light');
}

export function hapticSuccess() {
  getTelegramWebApp()?.HapticFeedback.notificationOccurred('success');
}

// Opens an EXTERNAL url (e.g. the ABA PayWay payment link) the right way
// from inside a Mini App.
//
// WHY THIS EXISTS -- a plain <a target="_blank"> does not work here.
// Inside Telegram the app runs in Telegram's own WebView. A normal link
// therefore opens Telegram's *in-app* browser, and that browser is a
// dead end for a payment link: iOS only hands an https universal link
// (link.payway.com.kh/...) over to the ABA app when the link is opened
// by the system, so in Telegram's browser the page just sits there
// blank/spinning and the ABA app never launches.
//
// WebApp.openLink() passes the url back to the Telegram *client*, which
// opens it outside the Mini App WebView -- that is the hand-off iOS
// needs. try_instant_view is explicitly false so Telegram never tries to
// render a reader-mode preview of a checkout page.
//
// Falls back to window.open when the app is opened in a normal browser
// (desktop dev, or a Mini App opened outside Telegram).
export function openExternalLink(url: string): void {
  if (!url) return;
  const tg = getTelegramWebApp();
  if (tg?.openLink) {
    try {
      tg.openLink(url, { try_instant_view: false });
      return;
    } catch {
      // Older clients can throw on the options argument -- retry bare.
      try {
        tg.openLink(url);
        return;
      } catch {
        // Fall through to the browser path below.
      }
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

// Copy helper for the "the link didn't open" escape hatch: the viewer
// can paste it into Safari/Chrome themselves, where the ABA app will
// pick it up. navigator.clipboard is unavailable on some older in-app
// WebViews, hence the textarea fallback.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}
