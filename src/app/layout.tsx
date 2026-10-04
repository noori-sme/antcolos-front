import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { site } from "@/config/brand";
import "@/styles/globals.css";
import { Providers } from "./providers";
import { SplashScreen } from "@/components/splash-screen";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-antcolos-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-antcolos-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: site.title, template: "%s · Antcolos" },
  description: site.description,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#2b2f33" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      cz-shortcut-listen="true"
      data-density="comfortable"
      className={`${sans.variable} ${mono.variable}`}
    >
      <body className="font-sans antialiased">
        <SplashScreen />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}