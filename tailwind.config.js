/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        'brand-bg': 'var(--bg-color)',
        'brand-text': 'var(--text-color)',
        'brand-primary': 'var(--primary-color)',
        'brand-secondary': 'var(--secondary-color)',
        'brand-accent': 'var(--accent-color)',
        'brand-card': 'var(--card-bg)',
        'brand-success': 'var(--success-color)',
        'brand-danger': 'var(--danger-color)',
        'brand-warning': 'var(--warning-color)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
