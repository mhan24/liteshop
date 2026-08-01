/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './composables/**/*.{js,ts}',
    './App.vue',
    './Error.vue',
  ],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0f6b53', dark: '#0a4f3e' },
      },
    },
  },
  plugins: [],
}
