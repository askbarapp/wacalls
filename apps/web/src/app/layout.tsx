import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const sans = Outfit({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "WaCalls — WhatsApp Web Calling",
  description: "Self-hosted WhatsApp web calling and sequential dialer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} font-sans bg-ink-950 text-slate-100 antialiased`}>
        {children}
      </body>
    </html>
  );
}
