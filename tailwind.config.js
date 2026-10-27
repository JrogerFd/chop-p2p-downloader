/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: '#0a0a0f',
          surface: '#111118',
          border: '#1e1e2e',
          primary: '#00ff88',
          secondary: '#00d4ff',
          accent: '#ff00ff',
          warn: '#ffaa00',
          error: '#ff0055'
        }
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'scan': 'scan 2s linear infinite'
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 5px rgba(0, 255, 136, 0.5)' },
          '50%': { boxShadow: '0 0 20px rgba(0, 255, 136, 0.8)' }
        },
        'scan': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        }
      }
    },
  },
  plugins: [],
}
