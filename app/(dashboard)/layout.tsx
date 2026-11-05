import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import AuthSessionProvider from "@/components/providers/SessionProvider";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import Footer from "@/components/layout/Footer";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  // Loaded from the DB (lib/auth); passed down for UX gating only.
  const permissions = [...(await getCurrentUserPermissions()).permissions];

  return (
    <AuthSessionProvider session={session}>
      <SidebarProvider>
        {/* Fills the window exactly — no fixed page width, so no sideways
            scroll; a wide table scrolls inside its own card instead. */}
        <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
          <Sidebar permissions={permissions} />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <Topbar permissions={permissions} />
            <main style={{ flex: 1, minWidth: 0, padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
              {children}
              <Footer />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </AuthSessionProvider>
  );
}
