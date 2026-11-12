import { pageGuard } from "@/lib/auth/page-guard";
import { currentDeviceId } from "@/lib/hardware/device";
import { PERMISSIONS } from "@/lib/permissions";
import { COLORS, FONTS } from "@/components/layout/theme";
import { requireRestaurant } from "../server/guard";
import { getInterfaceSettings } from "../server/services/interface";
import InterfaceForm from "../components/settings/InterfaceForm";

// /settings/restaurant/interface — Settings › Restaurant › Interface (Part
// 6f Step 1): the Service view (PIN login, the touch Tables screen and
// Restaurant POS) or the Classic view (Floor, Table order, the retail POS).
// Needs Manage Setting; a 404 while the module is off.
export default async function InterfaceSettingsPage() {
  await requireRestaurant();
  const denied = await pageGuard(PERMISSIONS.MANAGE_SETTING);
  if (denied) return denied;

  const settings = await getInterfaceSettings(await currentDeviceId());
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 880 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Interface</h1>
        <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>Which screens the restaurant uses. Both use the same orders, tables and actions.</p>
      </div>
      <InterfaceForm initial={settings} />
    </div>
  );
}
