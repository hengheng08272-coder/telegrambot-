// Canonical design tokens for NINT VIP's "Neon Streaming" dark theme — a
// deep near-black navy base, electric teal for anything the viewer should
// tap, neon violet for data/trending cues and antique gold reserved
// strictly for VIP / premium moments.
//
// Every value here is also published as a CSS custom property in
// src/index.css (`--nv-*`), which is the form components normally consume
// (`bg-[var(--nv-surface)]`, `text-[var(--nv-gold)]`). This file stays the
// single source of truth in TypeScript for anything that needs a token in
// JS — canvas drawing, inline SVG attributes, Telegram theming calls.
export const theme = {
  colors: {
    primary: '#12E7C6', // teal neon — CTAs, Play, active tab, ticker glow
    primaryDark: '#0B7F6D',
    primaryLight: '#6DFFE4',
    secondary: '#7B5CFF', // neon violet — trending/live cues, progress
    secondaryLight: '#A78BFA',
    accent: '#F5C563', // antique gold — VIP / crown / premium only
    accentDark: '#B98430',
    accentLight: '#FFE7B0',
    background: '#05070D', // page base — near-black navy, artwork provides the light
    backgroundDeep: '#000000', // behind the base (scrims, sheets, letterbox)
    surface: '#0D1119', // cards, bars
    surfaceLight: '#141A28', // raised card / input
    surfaceHover: '#1A2233',
    border: '#232A3D',
    text: '#F4F5FA',
    textMuted: '#9BA3BC',
    textDim: '#656E88',
    success: '#2FD98C',
    warning: '#FFC24D',
    error: '#FF4D5E',
  },
  gradients: {
    hero: 'linear-gradient(180deg, rgba(6,7,13,0) 0%, rgba(6,7,13,0.45) 52%, rgba(6,7,13,1) 100%)',
    heroLeft: 'linear-gradient(90deg, rgba(6,7,13,0.92) 0%, rgba(6,7,13,0.5) 50%, rgba(6,7,13,0) 100%)',
    card: 'linear-gradient(180deg, rgba(6,7,13,0) 40%, rgba(6,7,13,0.95) 100%)',
    primary: 'linear-gradient(135deg, #12E7C6 0%, #0B7F6D 100%)',
    vip: 'linear-gradient(135deg, #FFE7B0, #F5C563 45%, #B98430)',
    glow: 'radial-gradient(circle at 50% 0%, rgba(18,231,198,0.24) 0%, rgba(6,7,13,0) 62%)',
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
    glow: '0 0 34px rgba(18,231,198,0.4)',
    goldGlow: '0 0 28px rgba(245,197,99,0.32)',
  },
} as const;

export type Theme = typeof theme;
