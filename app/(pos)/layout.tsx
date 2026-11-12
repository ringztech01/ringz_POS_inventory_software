import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AuthSessionProvider from "@/components/providers/SessionProvider";
import DeviceBeacon from "@/components/hardware/DeviceBeacon";
import PrinterAlerts from "@/components/hardware/PrinterAlerts";
import ScanProvider from "@/components/hardware/ScanProvider";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { restaurantModule } from "@/modules/restaurant/manifest";
import { ServiceViewProvider } from "@/modules/restaurant/components/ServiceRoutes";
import { getServiceView } from "@/modules/restaurant/server/serviceView";

// Full-screen POS: same auth and session as the dashboard, no sidebar or top
// bar (RingzPOS POS.dc.html). In Restaurant mode the touch POS fills the
// window itself (fixed, no minimum width) and shows the printer alerts in
// its own header.
export default async function PosLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  if (await isModuleEnabled(restaurantModule.id)) {
    // Service view: the touch screens fill the window themselves. Classic:
    // /pos is the retail POS (below), its frame and all.
    const view = await getServiceView();
    if (view === "SERVICE")
      return (
        <AuthSessionProvider session={session}>
          <ServiceViewProvider view={view}>
            <DeviceBeacon />
            <ScanProvider>{children}</ScanProvider>
          </ServiceViewProvider>
        </AuthSessionProvider>
      );
  }

  return (
    <AuthSessionProvider session={session}>
      {/* This browser as a printing device (Settings › Printers' per-device printers). */}
      <DeviceBeacon />
      {/* The till's printers in trouble ("Receipt printer offline (2 waiting)"). */}
      <div className="no-print" style={{ position: "fixed", top: 8, right: 16, zIndex: 60 }}>
        <PrinterAlerts scope="till" />
      </div>
      {/* Barcode scans: the POS adds the item (its own handler). */}
      <ScanProvider>
        <div style={{ minHeight: "100vh", minWidth: 1440, background: "#eef1f4" }}>{children}</div>
      </ScanProvider>
    </AuthSessionProvider>
  );
}
