import daisyui from 'daisyui'

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
    extend: {},
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        liteshop: {
          primary: '#0f6b53',
          'primary-content': '#ffffff',
          secondary: '#4f46e5',
          'secondary-content': '#ffffff',
          accent: '#d97706',
          'accent-content': '#ffffff',
          neutral: '#1f2329',
          'neutral-content': '#f9fafb',
          'base-100': '#ffffff',
          'base-200': '#f3f5f7',
          'base-300': '#e4e8ec',
          'base-content': '#1f2937',
          info: '#2563eb',
          'info-content': '#ffffff',
          success: '#16a34a',
          'success-content': '#ffffff',
          warning: '#d97706',
          'warning-content': '#ffffff',
          error: '#dc2626',
          'error-content': '#ffffff',
          '--rounded-box': '1rem',
          '--rounded-btn': '0.9rem',
          '--rounded-badge': '1.9rem',
          '--animation-btn': '0.15s',
          '--animation-input': '0.15s',
          '--btn-text-case': 'none',
          '--btn-focus-scale': '0.97',
        },
      },
    ],
    logs: false,
  },
}
