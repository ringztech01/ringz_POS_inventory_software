import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { requireRestaurant } from "../../server/guard";

// /t/… — the tablet screens (Part 6g, design: RingzPOS Tablet.dc.html) for
// waiters, bar and kitchen staff on a device that's a Tablet (Settings ›
// Devices). A 404 while the module is off. Each page checks its own
// permission; the PIN login is open to anyone (the tablet isn't signed in).
// Installable: "RingzPOS Waiter" (/t/manifest.webmanifest).

export const metadata: Metadata = {
  title: "RingzPOS Waiter",
  manifest: "/t/manifest.webmanifest",
  applicationName: "RingzPOS Waiter",
  appleWebApp: { capable: true, title: "RingzPOS Waiter", statusBarStyle: "black" },
  icons: { icon: "/t/icon/192", apple: "/t/icon/192" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#000000", colorScheme: "dark" };

export default async function TabletLayout({ children }: { children: ReactNode }) {
  await requireRestaurant();
  return children;
}
