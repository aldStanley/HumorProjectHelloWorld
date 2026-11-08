/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Trebuchet MS"', 'Verdana', 'Arial', 'sans-serif'],
        serif: ['Georgia', '"Times New Roman"', 'Times', 'serif'],
      },
    },
  },
  plugins: [],
}
