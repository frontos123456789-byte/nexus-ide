import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/ide/Layout/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus — создайте сайт, бота или презентацию",
  description:
    "Nexus — помощник на базе ИИ. Опишите словами, что хотите: сайт, Telegram-бота, презентацию или приложение — и получите готовый результат.",
  applicationName: "Nexus IDE",
  keywords: ["IDE", "AI", "agents", "Monaco", "OpenRouter", "Next.js"],
  appleWebApp: { capable: true, title: "Nexus IDE", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays enabled (WCAG 1.4.4); fields are 16px so iOS does not auto-zoom. Draw under notches (safe-area paddings are applied in the UI).
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`dark ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="bg-background font-sans text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
