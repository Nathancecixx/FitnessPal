import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#0c111c',
        panel: '#111827',
        canvas: '#f4efe4',
        accent: '#d97706',
        lime: '#b7ff5c',
        steel: '#9ca3af',
      },
      boxShadow: {
        halo: '0 18px 60px rgba(15, 23, 42, 0.28)',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Segoe UI"', 'sans-serif'],
        display: ['"Space Grotesk"', '"Aptos"', 'sans-serif'],
      },
      backgroundImage: {
        mesh: 'radial-gradient(circle at 10% 10%, rgba(217, 119, 6, 0.22), transparent 35%), radial-gradient(circle at 80% 20%, rgba(183, 255, 92, 0.16), transparent 28%), radial-gradient(circle at 60% 80%, rgba(56, 189, 248, 0.12), transparent 30%)',
      },
    },
  },
  plugins: [],
} satisfies Config
