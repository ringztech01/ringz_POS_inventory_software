import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AuthSessionProvider from "@/components/providers/SessionProvider";

// Full-screen POS: same auth and session as the dashboard, no sidebar or top
// bar (RingzPOS POS.dc.html).
export default async function PosLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  return (
    <AuthSessionProvider session={session}>
      <div style={{ minHeight: "100vh", minWidth: 1440, background: "#eef1f4" }}>{children}</div>
    </AuthSessionProvider>
  );
}
