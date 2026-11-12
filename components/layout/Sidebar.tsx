import type { Permission } from "@/lib/permissions";
import { getEnabledModuleIds } from "@/lib/modules/enabled.server";
import SidebarPanel from "./SidebarPanel";

// The app sidebar. A server component only so it can read which optional
// modules are switched on (their groups show only then); the panel itself is
// SidebarPanel. `serviceOnly`: a Service-level role (Part 6f) — the service
// screens' items only.
export default async function Sidebar({ permissions, serviceOnly = false }: { permissions: Permission[]; serviceOnly?: boolean }) {
  return <SidebarPanel permissions={permissions} modules={await getEnabledModuleIds()} serviceOnly={serviceOnly} />;
}
