import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
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
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
              fontSize: 13.5,
              borderRadius: 9,
              border: "1px solid #dde2e3",
              boxShadow: "0 8px 24px -6px rgba(23,27,28,.20)",
            },
            success: {
              iconTheme: { primary: "#0f7d6a", secondary: "#fff" },
              style: { border: "1px solid #86cbc0" },
            },
            error: {
              iconTheme: { primary: "#b3261e", secondary: "#fff" },
              style: { border: "1px solid #f0c4c1" },
            },
          }}
        />
      </body>
    </html>
  );
}
