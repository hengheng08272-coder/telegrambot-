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
          DEFAULT: '#06070D',
          deep: '#03040A',
        },
        surface: {
          DEFAULT: '#0D1119',
          light: '#141A28',
          hover: '#1A2233',
        },
        hairline: 'rgba(255,255,255,0.08)',
        brand: {
          DEFAULT: '#12E7C6',
          light: '#6DFFE4',
          dark: '#0B7F6D',
        },
        indigo: {
          brand: '#7B5CFF',
          light: '#A78BFA',
        },
        gold: {
          DEFAULT: '#F5C563',
          light: '#FFE7B0',
          dark: '#B98430',
        },
        muted: '#9BA3BC',
        dim: '#656E88',
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
        card: '0 10px 30px rgba(0,0,0,0.55)',
        elevated: '0 24px 60px rgba(0,0,0,0.68)',
        glow: '0 0 34px rgba(18,231,198,0.4)',
        'glow-gold': '0 0 28px rgba(245,197,99,0.32)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #3DF0D4 0%, #12E7C6 45%, #0A9987 100%)',
        'vip-gradient': 'linear-gradient(135deg, #FFE7B0, #F5C563 45%, #B98430)',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(18,231,198,0.45)' },
          '50%': { boxShadow: '0 0 0 8px rgba(18,231,198,0)' },
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
