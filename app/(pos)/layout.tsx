import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AuthSessionProvider from "@/components/providers/SessionProvider";
import DeviceBeacon from "@/components/hardware/DeviceBeacon";
import PrinterAlerts from "@/components/hardware/PrinterAlerts";

// Full-screen POS: same auth and session as the dashboard, no sidebar or top
// bar (RingzPOS POS.dc.html).
export default async function PosLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  return (
    <AuthSessionProvider session={session}>
      {/* This browser as a printing device (Settings › Printers' per-device printers). */}
      <DeviceBeacon />
      {/* The till's printers in trouble ("Receipt printer offline (2 waiting)"). */}
      <div className="no-print" style={{ position: "fixed", top: 8, right: 16, zIndex: 60 }}>
        <PrinterAlerts scope="till" />
      </div>
      <div style={{ minHeight: "100vh", minWidth: 1440, background: "#eef1f4" }}>{children}</div>
    </AuthSessionProvider>
  );
}
