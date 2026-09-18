import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
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

  return (
    <AuthSessionProvider session={session}>
      <SidebarProvider>
        <div style={{ display: "flex", minHeight: "100vh", minWidth: 1440 }}>
          <Sidebar />
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <Topbar />
            <main style={{ flex: 1, padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
              {children}
              <Footer />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </AuthSessionProvider>
  );
}
