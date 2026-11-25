/**
 * Branding lives here. To rename the app, change these values
 * (and replace the SVGs in /public/brand, then run `npm run icons`).
 */
export const brand = {
  name: "Upvance",
  tagline: "Move your career up and forward.",
  description:
    "An AI job-search and application assistant for international candidates: honest matching, visa-aware eligibility and human-approved applications.",
  colors: {
    primary: "#6D28D9", // violet
    secondary: "#2563EB", // blue
    gradientFrom: "#7C3AED",
    gradientTo: "#2563EB",
    themeLight: "#ffffff",
    themeDark: "#0b0b14",
  },
  logo: {
    full: "/brand/logo.svg",
    icon: "/brand/icon.svg",
    mono: "/brand/logo-mono.svg",
  },
} as const;

export type Brand = typeof brand;
