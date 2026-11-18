import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import AppToaster from "@/components/providers/AppToaster";
import { GUEST_SURFACE_HEADER } from "@/modules/restaurant/lib/publicMenu";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RingzPOS",
  description: "RingzPOS inventory & POS admin dashboard",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The guest's digital menu (Part 8, /menu/…, marked by the proxy): phones
  // on the restaurant's Wi-Fi, maybe with no internet — no web fonts from
  // Google, no toasts; system fonts and the page's own styles only.
  if ((await headers()).get(GUEST_SURFACE_HEADER) === "menu") {
    return (
      <html lang="en">
        <body style={{ margin: 0, background: "#fafbfb", color: "#171b1c", WebkitFontSmoothing: "antialiased" }}>{children}</body>
      </html>
    );
  }
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <style>{`
          body { margin:0; background:#f5f7f7; color:#171b1c; font-family:'IBM Plex Sans',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
          a { color:#0f7d6a; text-decoration:none; }
          a:hover { color:#0a6355; text-decoration:underline; }
          * { box-sizing:border-box; }
          input, select, textarea, button { font-family:inherit; }
          @keyframes elv-pop { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:none; } }
        `}</style>
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
