import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import ForbiddenState from "@/components/ui/ForbiddenState";
import ScannerTestPanel from "@/components/settings/ScannerTestPanel";

// /settings/scanner — Settings › Devices › Scanner test: the last scanned
// code and its timing, and this device's scanner limits. Manage Setting.
export default async function ScannerTestPage() {
  const { permissions } = await getCurrentUserPermissions();
  if (!permissions.has(PERMISSIONS.MANAGE_SETTING)) return <ForbiddenState permission={PERMISSIONS.MANAGE_SETTING} />;
  return <ScannerTestPanel />;
}
