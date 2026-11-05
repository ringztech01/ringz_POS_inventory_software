import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { EVENTS_PER_PAGE, getDrawerEvents, readDrawerFilter } from "@/lib/hardware/drawerLog";
import ForbiddenState from "@/components/ui/ForbiddenState";
import DrawerLogPanel from "@/components/settings/printers/DrawerLogPanel";

// /settings/drawer-log[?reason&page] — every time the cash drawer was told
// to open: when, why (a cash sale or refund, by hand with the reason typed,
// a test), who, at which till, and whether it opened. Needs Manage Setting.
export default async function DrawerLogPage({ searchParams }: { searchParams: Promise<{ reason?: string; page?: string }> }) {
  const { permissions } = await getCurrentUserPermissions();
  if (!permissions.has(PERMISSIONS.MANAGE_SETTING)) return <ForbiddenState permission={PERMISSIONS.MANAGE_SETTING} />;
  const filter = readDrawerFilter(await searchParams);
  const { rows, total, counts } = await getDrawerEvents(filter);
  return <DrawerLogPanel rows={rows} counts={counts} reason={filter.reason ?? ""} page={filter.page} total={total} totalPages={Math.max(1, Math.ceil(total / EVENTS_PER_PAGE))} />;
}
