// Canonical design tokens for NINT VIP's dark theme — a midnight-navy
// base under the artwork, one brand blue for anything the viewer should
// tap (the same blue the checkout is built from), red for quiet marks
// that are not actions, and antique gold reserved strictly for VIP.
//
// Every value here is also published as a CSS custom property in
// src/index.css (`--nv-*`), which is the form components normally consume
// (`bg-[var(--nv-surface)]`, `text-[var(--nv-gold)]`). This file stays the
// single source of truth in TypeScript for anything that needs a token in
// JS — canvas drawing, inline SVG attributes, Telegram theming calls.
export const theme = {
  colors: {
    primary: '#2050D8', // brand blue — CTAs, Play, active tab, checkout
    primaryDark: '#0E2560',
    primaryLight: '#4E86FF',
    secondary: '#E6231F', // accent red — quiet marks that are not actions
    secondaryLight: '#FF6B60',
    accent: '#F5C563', // antique gold — VIP / crown / premium only
    accentDark: '#B98430',
    accentLight: '#FFE7B0',
    background: '#0A101E', // page base — midnight navy under the artwork
    backgroundDeep: '#060A14', // behind the base (scrims, sheets, letterbox)
    surface: '#111A2E', // cards, bars
    surfaceLight: '#17223A', // raised card / input
    surfaceHover: '#1E2B48',
    border: '#26365A',
    text: '#EEF1F8',
    textMuted: '#9AA4BD',
    textDim: '#6A7591',
    success: '#2FD98C',
    warning: '#FFC24D',
    error: '#FF6B60',
  },
  gradients: {
    hero: 'linear-gradient(180deg, rgba(10,16,30,0) 0%, rgba(10,16,30,0.45) 52%, rgba(10,16,30,1) 100%)',
    heroLeft: 'linear-gradient(90deg, rgba(10,16,30,0.92) 0%, rgba(10,16,30,0.5) 50%, rgba(10,16,30,0) 100%)',
    card: 'linear-gradient(180deg, rgba(10,16,30,0) 40%, rgba(10,16,30,0.95) 100%)',
    primary: 'linear-gradient(135deg, #2050D8 0%, #0E2560 100%)',
    vip: 'linear-gradient(135deg, #FFE7B0, #F5C563 45%, #B98430)',
    glow: 'radial-gradient(circle at 50% 0%, rgba(32,80,216,0.18) 0%, rgba(10,16,30,0) 62%)',
    // Glow cast by the hero's blurred poster over the black page.
    heroGlow:
      'linear-gradient(180deg, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.55) 16%, rgba(0,0,0,0.05) 36%, rgba(0,0,0,0.15) 70%, rgba(0,0,0,0.8) 90%, rgba(0,0,0,1) 100%)',
  },
  fonts: {
    display: '"Anton", "Battambang", "Poppins", system-ui, sans-serif',
    body: '"Battambang", "Poppins", "Inter", system-ui, -apple-system, sans-serif',
  },
  radius: {
    sm: '6px',
    md: '10px',
    lg: '12px',
    xl: '18px',
    pill: '9999px',
  },
  shadows: {
    card: '0 10px 30px rgba(0,0,0,0.55)',
    elevated: '0 24px 60px rgba(0,0,0,0.68)',
    glow: '0 0 34px rgba(32,80,216,0.3)',
    goldGlow: '0 0 28px rgba(245,197,99,0.32)',
  },
} as const;

export type Theme = typeof theme;
