/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // `xs` sits between the default base and `sm` (640px) — useful for
      // header/pill layouts that need one extra step on phones without
      // affecting anything already keyed to `sm:` and up.
      screens: {
        xs: '380px',
      },
      // Semantic names for the "Neon Streaming" dark theme (see theme.ts
      // and the --nv-* custom properties in src/index.css). New UI should
      // reach for these — `bg-surface`, `text-muted`, `border-hairline` —
      // instead of pasting hex values into arbitrary-value classes.
      colors: {
        base: {
          DEFAULT: '#0A101E',
          deep: '#060A14',
        },
        surface: {
          DEFAULT: '#111A2E',
          light: '#17223A',
          hover: '#1E2B48',
        },
        hairline: 'rgba(146,172,224,0.12)',
        // One blue for anything that acts, app and checkout alike.
        brand: {
          DEFAULT: '#2050D8',
          light: '#4E86FF',
          dark: '#0E2560',
        },
        // Quiet marks that are not actions — "ongoing", section icons,
        // Coming Soon. Red earns attention without being tappable.
        accent: {
          DEFAULT: '#E6231F',
          light: '#FF6B60',
        },
        indigo: {
          brand: '#E6231F',
          light: '#FF6B60',
        },
        // Gold has exactly one job left: VIP.
        gold: {
          DEFAULT: '#F5C563',
          light: '#FFE7B0',
          dark: '#B98430',
        },
        muted: '#9AA4BD',
        dim: '#6A7591',
      },
      fontFamily: {
        khmer: ['Battambang', 'Khmer OS Battambang', 'system-ui', 'sans-serif'],
        display: ['Anton', 'Battambang', 'Poppins', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
        sheet: '18px',
      },
      boxShadow: {
        card: '0 10px 30px rgba(4,8,18,0.6)',
        elevated: '0 24px 60px rgba(4,8,18,0.72)',
        glow: '0 0 34px rgba(32,80,216,0.3)',
        'glow-gold': '0 0 28px rgba(245,197,99,0.28)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #2050D8 0%, #1A3FAE 55%, #0E2560 100%)',
        'vip-gradient': 'linear-gradient(135deg, #FFE7B0, #F5C563 45%, #B98430)',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(32,80,216,0.45)' },
          '50%': { boxShadow: '0 0 0 8px rgba(32,80,216,0)' },
        },
        'badge-pop': {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '60%': { transform: 'scale(1.08)', opacity: '1' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'glow-pulse': 'glow-pulse 2.2s ease-in-out infinite',
        'badge-pop': 'badge-pop 0.4s cubic-bezier(0.34,1.56,0.64,1)',
      },
    },
  },
  plugins: [],
};
