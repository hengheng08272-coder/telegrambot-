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
    user?: { id: number; username?: string; first_name?: string };
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
  // Opens Telegram's own "forward to a chat" picker for a t.me link —
  // the native way to share something from inside a Mini App, distinct
  // from openLink (which just opens a URL in-app/externally).
  openTelegramLink?: (url: string) => void;
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

// Call once on app boot: tells Telegram the app is ready to be shown and
// expands it to full height (otherwise it opens as a half-height sheet).
export function initTelegramApp() {
  const tg = getTelegramWebApp();
  if (!tg) return;
  tg.ready();
  tg.expand();
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

// Invites a friend to the VIP group itself — deliberately NOT a deep
// link into any show. Sharing content directly (even just a "here's a
// link" message) meant anyone who received it could open the Mini App
// and watch for free without ever joining or paying, since the app has
// no other gate at that point besides verify-membership. Sharing the
// group's own invite link instead only ever leads to the join/paywall
// flow — nothing plays until they're actually a member. Needs
// VITE_TELEGRAM_GROUP_LINK configured; without it this is a no-op.
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
