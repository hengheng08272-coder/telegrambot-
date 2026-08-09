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

// The `start_param` from a deep link like
// https://t.me/YourBot/app?startapp=show_<id> arrives here as "show_<id>".
export function getStartParam(): string | null {
  return getTelegramWebApp()?.initDataUnsafe?.start_param ?? null;
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
