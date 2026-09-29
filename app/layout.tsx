import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { themeCss } from "@/theme/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Placeholder heading font until the official Apex font is provided (see theme/theme.ts).
const heading = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: "Apex Analytics",
  description: "Apex Brands internal performance dashboard",
  icons: { icon: "/brand/apex-icon-accent.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${heading.variable} h-full antialiased`}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body className="min-h-full bg-bg text-text">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
