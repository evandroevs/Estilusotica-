/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Escala grafite neutra (estilo fintech/Stakent): sem viés azul.
        // Agora dirigida por CSS variables (canais RGB) para permitir troca de
        // tema em runtime (dark ↔ claro estilo Claude). Os valores por tema ficam
        // em src/index.css (:root = dark, html.theme-light = claro).
        gray: {
          50:  "rgb(var(--c-gray-50)  / <alpha-value>)",
          100: "rgb(var(--c-gray-100) / <alpha-value>)",
          200: "rgb(var(--c-gray-200) / <alpha-value>)",
          300: "rgb(var(--c-gray-300) / <alpha-value>)",
          400: "rgb(var(--c-gray-400) / <alpha-value>)",
          500: "rgb(var(--c-gray-500) / <alpha-value>)",
          600: "rgb(var(--c-gray-600) / <alpha-value>)",
          700: "rgb(var(--c-gray-700) / <alpha-value>)",
          800: "rgb(var(--c-gray-800) / <alpha-value>)",
          900: "rgb(var(--c-gray-900) / <alpha-value>)",
          950: "rgb(var(--c-gray-950) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--c-accent)       / <alpha-value>)",
          hover:   "rgb(var(--c-accent-hover) / <alpha-value>)",
          dim:     "rgb(var(--c-accent) / 0.10)",
        },
        brand: {
          50:  "#f0f4ff",
          100: "#dde6ff",
          200: "#c0cfff",
          300: "#95adff",
          400: "#6480ff",
          500: "#3d54ff",
          600: "#2232f5",
          700: "#1a24e1",
          800: "#1b20b5",
          900: "#1c218f",
          950: "#111355",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      keyframes: {
        slideInRight: {
          from: { transform: "translateX(calc(100% + 24px))", opacity: "0" },
          to:   { transform: "translateX(0)",                  opacity: "1" },
        },
        fadeOut: {
          from: { opacity: "1" },
          to:   { opacity: "0" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        "slide-in-right": "slideInRight 0.22s ease-out",
        "fade-out":        "fadeOut 0.3s ease-in forwards",
        shimmer:           "shimmer 1.4s infinite linear",
      },
    },
  },
  plugins: [],
}
