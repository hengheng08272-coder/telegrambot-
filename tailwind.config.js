/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Semantic names for the "Obsidian" dark theme (see theme.ts and the
      // --nv-* custom properties in src/index.css). New UI should reach for
      // these — `bg-surface`, `text-muted`, `border-hairline` — instead of
      // pasting hex values into arbitrary-value classes.
      colors: {
        base: {
          DEFAULT: '#07080C',
          deep: '#04050A',
        },
        surface: {
          DEFAULT: '#0E1017',
          light: '#151926',
          hover: '#1B2030',
        },
        hairline: 'rgba(255,255,255,0.08)',
        brand: {
          DEFAULT: '#FF2D46',
          light: '#FF6B7C',
          dark: '#8F1020',
        },
        indigo: {
          brand: '#4C6FFF',
          light: '#8098FF',
        },
        gold: {
          DEFAULT: '#F5C563',
          light: '#FFE7B0',
          dark: '#B98430',
        },
        muted: '#A0A5B8',
        dim: '#6C7185',
      },
      fontFamily: {
        khmer: ['Battambang', 'Khmer OS Battambang', 'system-ui', 'sans-serif'],
        display: ['Anton', 'Battambang', 'Poppins', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '18px',
        sheet: '26px',
      },
      boxShadow: {
        card: '0 10px 30px rgba(0,0,0,0.55)',
        elevated: '0 24px 60px rgba(0,0,0,0.68)',
        glow: '0 0 34px rgba(255,45,70,0.38)',
        'glow-gold': '0 0 28px rgba(245,197,99,0.32)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #FF445A 0%, #FF2D46 45%, #C4142C 100%)',
        'vip-gradient': 'linear-gradient(135deg, #FFE7B0, #F5C563 45%, #B98430)',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255,45,70,0.45)' },
          '50%': { boxShadow: '0 0 0 8px rgba(255,45,70,0)' },
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
