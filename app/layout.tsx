import type { Metadata, Viewport } from "next";
import { Golos_Text, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const golos = Golos_Text({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-golos",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Спринт",
  description: "План дня по часам, напоминания и путь к первому офферу.",
  applicationName: "Спринт",
  appleWebApp: { capable: true, title: "Спринт", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1311" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${golos.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans text-[15px] leading-snug antialiased">{children}</body>
    </html>
  );
}
