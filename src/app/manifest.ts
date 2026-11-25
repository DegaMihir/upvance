import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${brand.name} – ${brand.tagline}`,
    short_name: brand.name,
    description: brand.description,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: brand.colors.themeLight,
    theme_color: brand.colors.primary,
    categories: ["productivity", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/brand/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Match feed", url: "/jobs" },
      { name: "Needs you", url: "/applications?tab=needs-you" },
    ],
  };
}
