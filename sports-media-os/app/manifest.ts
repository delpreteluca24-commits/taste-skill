import type { MetadataRoute } from "next";

/** Installable on a phone ("Add to Home Screen"): opens full-screen on the dashboard. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sports Media OS",
    short_name: "Sports OS",
    description: "Find what is about to go viral in sport, verify it, script it, publish it.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0f1a",
    theme_color: "#0b0f1a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
