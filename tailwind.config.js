/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "var(--cp-border)",
        input: "var(--cp-border-strong)",
        ring: "var(--cp-accent)",
        background: "var(--cp-bg)",
        foreground: "var(--cp-text)",
        primary: {
          DEFAULT: "var(--cp-accent)",
          foreground: "var(--cp-accent-fg)",
        },
        secondary: {
          DEFAULT: "var(--cp-surface-soft)",
          foreground: "var(--cp-text)",
        },
        destructive: {
          DEFAULT: "var(--cp-danger)",
          foreground: "var(--cp-accent-fg)",
        },
        muted: {
          DEFAULT: "var(--cp-surface-soft)",
          foreground: "var(--cp-text-muted)",
        },
        accent: {
          DEFAULT: "var(--cp-accent-soft)",
          foreground: "var(--cp-accent)",
        },
        popover: {
          DEFAULT: "var(--cp-panel-strong)",
          foreground: "var(--cp-text)",
        },
        card: {
          DEFAULT: "var(--cp-surface)",
          foreground: "var(--cp-text)",
        },
      },
      borderRadius: {
        lg: "16px",
        md: "0.625rem",
        sm: "0.5rem",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
