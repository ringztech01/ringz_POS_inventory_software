import type { ReactNode } from "react";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";

// The Reports shell. The tab bar itself is rendered by the Topbar on /reports
// pages (RingzPOS Reports design: the tabs replace the breadcrumb and search
// in the top bar). Manage Reports gates the whole section here — and every
// report page and export checks it again, since a layout isn't re-rendered
// on navigation between its pages.
export default async function ReportsLayout({ children }: { children: ReactNode }) {
  const denied = await pageGuard(PERMISSIONS.MANAGE_REPORTS);
  if (denied) return denied;

  return <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>{children}</div>;
}
