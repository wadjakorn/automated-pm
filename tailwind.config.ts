import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0d1117",
          soft: "#161b22",
          card: "#1c2128",
        },
        border: {
          DEFAULT: "#30363d",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
