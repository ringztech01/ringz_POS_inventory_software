import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { getPrinterSetup } from "@/lib/hardware/printerSetup";
import ForbiddenState from "@/components/ui/ForbiddenState";
import DeviceBeacon from "@/components/hardware/DeviceBeacon";
import PrintersPanel from "@/components/settings/printers/PrintersPanel";

// /settings/printers — Settings › Printers: the printers (found by the
// hardware bridge, or added by IP), which printer does each job (role →
// printer, with copies and a fallback), and per-device overrides. Needs
// Manage Setting.
export default async function PrintersPage() {
  const { permissions } = await getCurrentUserPermissions();
  if (!permissions.has(PERMISSIONS.MANAGE_SETTING)) return <ForbiddenState permission={PERMISSIONS.MANAGE_SETTING} />;
  const setup = await getPrinterSetup();
  return (
    <>
      <DeviceBeacon />
      <PrintersPanel setup={setup} />
    </>
  );
}
