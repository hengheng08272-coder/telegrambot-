// Canonical design tokens for NINT VIP's "red / dark blue / black" theme.
// Components apply these as inline Tailwind arbitrary values rather than
// importing this file directly, but this is the single source of truth
// for the palette when adding new UI.
export const theme = {
  colors: {
    primary: '#E6231F', // red — CTAs, Play, active tab, ticker glow
    primaryDark: '#7A0F0D',
    primaryLight: '#F0453A',
    secondary: '#2B5CAD', // dark blue — trending/live cues, hero progress bar
    accent: '#E3B341', // antique gold — VIP / crown / premium only
    accentDark: '#A9782E',
    accentLight: '#F0D9A0',
    background: '#0A0A0D',
    surface: '#0F1116',
    surfaceLight: '#151822',
    surfaceHover: '#1B1F2A',
    text: '#F5F3F7',
    textMuted: '#A8A3B0',
    textDim: '#78748A',
    success: '#34B37A',
    warning: '#F59E0B',
    error: '#EF4444',
    border: '#1B1F2A',
  },
  gradients: {
    hero: 'linear-gradient(180deg, rgba(10,10,13,0) 0%, rgba(10,10,13,0.4) 50%, rgba(10,10,13,1) 100%)',
    heroLeft: 'linear-gradient(90deg, rgba(10,10,13,0.9) 0%, rgba(10,10,13,0.5) 50%, rgba(10,10,13,0) 100%)',
    card: 'linear-gradient(180deg, rgba(10,10,13,0) 40%, rgba(10,10,13,0.95) 100%)',
    primary: 'linear-gradient(135deg, #E6231F 0%, #7A0F0D 100%)',
    vip: 'linear-gradient(135deg, #F0D9A0, #E3B341 45%, #A9782E)',
    glow: 'radial-gradient(circle at 50% 0%, rgba(230,35,31,0.24) 0%, rgba(10,10,13,0) 60%)',
  },
  fonts: {
    display: '"Anton", "Battambang", "Poppins", system-ui, sans-serif',
    body: '"Battambang", "Poppins", "Inter", system-ui, -apple-system, sans-serif',
  },
  radius: {
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '24px',
  },
  shadows: {
    card: '0 8px 24px rgba(0,0,0,0.5)',
    elevated: '0 20px 50px rgba(0,0,0,0.6)',
    glow: '0 0 30px rgba(230,35,31,0.35)',
  },
} as const;

export type Theme = typeof theme;
