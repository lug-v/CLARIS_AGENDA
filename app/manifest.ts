import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clari — Agenda Inteligente",
    short_name: "Clari",
    description: "Transforme voz, foto ou texto em compromissos organizados.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7ff",
    theme_color: "#6d5dfc",
    lang: "pt-BR",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
