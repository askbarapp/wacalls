import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { BrandingProvider } from "@/components/branding-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const sans = Outfit({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "WaCalls",
  description: "WhatsApp calling, bulk messaging, and a calling SDK",
};

const themeBoot = `(function(){try{var t=localStorage.getItem("wacalls-theme");if(t!=="light"&&t!=="dark")t="dark";document.documentElement.classList.add(t);document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className={`${sans.variable} font-sans bg-ink-950 text-slate-100 antialiased`}>
        <ThemeProvider>
          <BrandingProvider>{children}</BrandingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
