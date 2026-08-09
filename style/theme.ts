export const theme = {
  colors: {
    primary: '#A855F7',
    primaryDark: '#6D28D9',
    primaryLight: '#D8B4FE',
    accent: '#FFC94A',
    background: '#0C0916',
    surface: '#161228',
    surfaceLight: '#1E1836',
    surfaceHover: '#2B2447',
    text: '#F5F1FF',
    textMuted: '#B0A6CC',
    textDim: '#71678F',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    border: '#2B2447',
    pink: '#FF4D8D',
  },
  gradients: {
    hero: 'linear-gradient(180deg, rgba(12,9,22,0) 0%, rgba(12,9,22,0.4) 50%, rgba(12,9,22,1) 100%)',
    heroLeft: 'linear-gradient(90deg, rgba(12,9,22,0.9) 0%, rgba(12,9,22,0.5) 50%, rgba(12,9,22,0) 100%)',
    card: 'linear-gradient(180deg, rgba(12,9,22,0) 40%, rgba(12,9,22,0.95) 100%)',
    primary: 'linear-gradient(135deg, #A855F7 0%, #FF4D8D 100%)',
    glow: 'radial-gradient(circle at 50% 0%, rgba(168,85,247,0.28) 0%, rgba(12,9,22,0) 60%)',
  },
  fonts: {
    display: '"Battambang", "Poppins", system-ui, sans-serif',
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
    glow: '0 0 30px rgba(15,143,114,0.35)',
  },
} as const;

export type Theme = typeof theme;
