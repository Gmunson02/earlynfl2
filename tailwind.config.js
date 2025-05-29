/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class", // <-- THIS is what enables class-based dark mode
  content: [
    "./src/pages/**/*.{js,jsx,ts,tsx}",
    "./src/components/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
