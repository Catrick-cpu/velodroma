/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // single restrained accent (Strava-orange) — brand/accent stay aliases
        // so existing class names keep one consistent meaning.
        brand: { 300: '#ffb27a', 400: '#ff8a4c', 500: '#fc5200', 600: '#e04300', 700: '#b83a00' },
        accent: { 300: '#ffb27a', 400: '#ff8a4c', 500: '#fc5200', 600: '#e04300' },
        volt: '#4ade80'
      },
      boxShadow: {
        glow: '0 1px 2px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.25)',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    }
  },
  plugins: []
}
