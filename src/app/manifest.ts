import type { MetadataRoute } from "next";

/** Lets phones install Nexus IDE to the home screen and run it full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexus IDE",
    short_name: "Nexus",
    description: "Мульти-агентная среда разработки с ИИ",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
