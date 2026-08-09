export const theme = {
  colors: {
    primary: '#E31E24',
    primaryDark: '#8C0F12',
    primaryLight: '#FF6A57',
    accent: '#FFC94A',
    background: '#0A0605',
    surface: '#170D0C',
    surfaceLight: '#241413',
    surfaceHover: '#3A1E1D',
    text: '#F5F1EE',
    textMuted: '#B8A8A6',
    textDim: '#8C7876',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    border: '#3A1E1D',
    pink: '#FF6A3D',
  },
  gradients: {
    hero: 'linear-gradient(180deg, rgba(10,6,5,0) 0%, rgba(10,6,5,0.4) 50%, rgba(10,6,5,1) 100%)',
    heroLeft: 'linear-gradient(90deg, rgba(10,6,5,0.9) 0%, rgba(10,6,5,0.5) 50%, rgba(10,6,5,0) 100%)',
    card: 'linear-gradient(180deg, rgba(10,6,5,0) 40%, rgba(10,6,5,0.95) 100%)',
    primary: 'linear-gradient(135deg, #E31E24 0%, #FF6A3D 100%)',
    glow: 'radial-gradient(circle at 50% 0%, rgba(227,30,36,0.28) 0%, rgba(10,6,5,0) 60%)',
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
    glow: '0 0 30px rgba(227,30,36,0.35)',
  },
} as const;

export type Theme = typeof theme;
