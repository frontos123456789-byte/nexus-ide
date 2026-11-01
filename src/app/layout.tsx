import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/ide/Layout/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus IDE — мульти-агентная среда разработки",
  description:
    "Веб-IDE с ИИ-агентами: Chat, Work и Code. Director оркестрирует Coder, Reviewer и Architect параллельно. Работает на бесплатных моделях OpenRouter.",
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
  // Phone IDE: no auto-zoom when focusing the editor/inputs, and draw under notches (safe-area paddings are applied in the UI).
  maximumScale: 1,
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
