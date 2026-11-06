/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./screens/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./features/**/*.{js,jsx,ts,tsx}",
    "./navigation/**/*.{js,jsx,ts,tsx}",
    "./contexts/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: { mytruck: { teal: "#179B83", orange: "#F47721", dark: "#0B2A26", light: "#F5FAF9" } },
    },
  },
  plugins: [],
};
