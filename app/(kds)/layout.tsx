import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireRestaurant } from "@/modules/restaurant/server/guard";
import DeviceBeacon from "@/components/hardware/DeviceBeacon";

// Full-screen restaurant screens (the kitchen display): signed in, no
// sidebar or top bar. 404 while the Restaurant module is off; each page
// checks its own permission.
export default async function KdsLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session) {
    redirect("/");
  }
  await requireRestaurant();
  return (
    <div style={{ minHeight: "100vh", background: "#12181a" }}>
      <DeviceBeacon />
      {children}
    </div>
  );
}
