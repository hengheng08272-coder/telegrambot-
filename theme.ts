// Canonical design tokens for NINT VIP's "Obsidian" dark theme — a deep
// blue-black cinema base, vivid scarlet for anything the viewer should
// tap, electric indigo for data/trending cues and antique gold reserved
// strictly for VIP / premium moments.
//
// Every value here is also published as a CSS custom property in
// src/index.css (`--nv-*`), which is the form components normally consume
// (`bg-[var(--nv-surface)]`, `text-[var(--nv-gold)]`). This file stays the
// single source of truth in TypeScript for anything that needs a token in
// JS — canvas drawing, inline SVG attributes, Telegram theming calls.
export const theme = {
  colors: {
    primary: '#FF2D46', // scarlet — CTAs, Play, active tab, ticker glow
    primaryDark: '#8F1020',
    primaryLight: '#FF6B7C',
    secondary: '#4C6FFF', // electric indigo — trending/live cues, progress
    secondaryLight: '#8098FF',
    accent: '#F5C563', // antique gold — VIP / crown / premium only
    accentDark: '#B98430',
    accentLight: '#FFE7B0',
    background: '#050609', // page base — flat black, artwork provides the light
    backgroundDeep: '#000000', // behind the base (scrims, sheets, letterbox)
    surface: '#0E1017', // cards, bars
    surfaceLight: '#151926', // raised card / input
    surfaceHover: '#1B2030',
    border: '#232838',
    text: '#F4F5FA',
    textMuted: '#A0A5B8',
    textDim: '#6C7185',
    success: '#2FD98C',
    warning: '#FFC24D',
    error: '#FF4D5E',
  },
  gradients: {
    hero: 'linear-gradient(180deg, rgba(7,8,12,0) 0%, rgba(7,8,12,0.45) 52%, rgba(7,8,12,1) 100%)',
    heroLeft: 'linear-gradient(90deg, rgba(7,8,12,0.92) 0%, rgba(7,8,12,0.5) 50%, rgba(7,8,12,0) 100%)',
    card: 'linear-gradient(180deg, rgba(7,8,12,0) 40%, rgba(7,8,12,0.95) 100%)',
    primary: 'linear-gradient(135deg, #FF2D46 0%, #8F1020 100%)',
    vip: 'linear-gradient(135deg, #FFE7B0, #F5C563 45%, #B98430)',
    glow: 'radial-gradient(circle at 50% 0%, rgba(255,45,70,0.26) 0%, rgba(7,8,12,0) 62%)',
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
    glow: '0 0 34px rgba(255,45,70,0.38)',
    goldGlow: '0 0 28px rgba(245,197,99,0.32)',
  },
} as const;

export type Theme = typeof theme;
