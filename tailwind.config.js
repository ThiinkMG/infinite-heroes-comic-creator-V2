/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './stores/**/*.{ts,tsx}',
    './contexts/**/*.{ts,tsx}',
    './data/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // 'font-comic' is used throughout for headings and comic chrome.
        comic: ['Bangers', 'cursive'],
        // Body copy: Comic Neue is the house voice, but it is hard to read below
        // ~16px, so UI chrome uses the system stack instead.
        body: ['"Comic Neue"', 'sans-serif'],
        ui: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
