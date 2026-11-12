import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import AuthSessionProvider from "@/components/providers/SessionProvider";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import Footer from "@/components/layout/Footer";
import ScanProvider from "@/components/hardware/ScanProvider";
import ProductScanRoute from "@/components/hardware/ProductScanRoute";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { restaurantModule } from "@/modules/restaurant/manifest";
import { ServiceViewProvider } from "@/modules/restaurant/components/ServiceRoutes";
import { getServiceView } from "@/modules/restaurant/server/serviceView";
import { staffHomeOn } from "@/modules/restaurant/server/services/pinSignIn";
import { currentDeviceId } from "@/lib/hardware/device";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  // Loaded from the DB (lib/auth); passed down for UX gating only.
  const current = await getCurrentUserPermissions();
  const permissions = [...current.permissions];
  // The restaurant's view on this device (Part 6f): where "Tables" and an
  // order's links go.
  const restaurantOn = await isModuleEnabled(restaurantModule.id);
  const view = restaurantOn ? await getServiceView() : "CLASSIC";
  // Back office → Service (Part 6f Step 5): the header's Service button goes
  // to this person's home screen. A Service-level user here (the Classic
  // floor or order) sees only the service screens' parts of the chrome.
  const serviceHref = restaurantOn && current.userId && !current.serviceOnly ? await staffHomeOn(current.userId, await currentDeviceId()).catch(() => null) : null;

  return (
    <AuthSessionProvider session={session}>
      <ServiceViewProvider view={view}>
      <SidebarProvider>
        {/* Barcode scans anywhere (components/hardware/ScanProvider.tsx);
            with no screen of its own taking them, a scan opens the product. */}
        <ScanProvider>
        {!current.serviceOnly && <ProductScanRoute />}
        {/* Fills the window exactly — no fixed page width, so no sideways
            scroll; a wide table scrolls inside its own card instead. */}
        <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
          <Sidebar permissions={permissions} serviceOnly={current.serviceOnly} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <Topbar permissions={permissions} serviceOnly={current.serviceOnly} serviceHref={serviceHref} roleName={current.roleName} />
            <main style={{ flex: 1, minWidth: 0, padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
              {children}
              <Footer />
            </main>
          </div>
        </div>
        </ScanProvider>
      </SidebarProvider>
      </ServiceViewProvider>
    </AuthSessionProvider>
  );
}
