/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'system-ui', 'Inter', 'Segoe UI', 'sans-serif'],
        mono: ['SF Mono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        ink: '#1c1c1e',
        mut: '#8a8a90',
        line: '#e8e8ea',
        wash: '#f6f6f7',
        card: '#f4f4f5',
      },
      boxShadow: {
        win: '0 34px 90px -18px rgba(15,35,80,.45), 0 10px 32px rgba(15,35,80,.22)',
        pop: '0 14px 44px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08)',
      },
    },
  },
  plugins: [],
};
