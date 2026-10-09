/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0D0D0D',
        coal: '#171717',
        cream: '#F5EFE8',
        blush: '#E9A0A8',
        rose: '#C95C70',
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', '"Times New Roman"', 'serif'],
        sans: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: { label: '0.28em' },
    },
  },
  plugins: [],
}
