/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#0b5d3b", dark: "#08442b", light: "#e6f4ec" } },
      minHeight: { tap: "2.75rem" },
    },
  },
  plugins: [],
};
