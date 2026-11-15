import { FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getPosSettings } from "../server/queries/posScreen";
import { getReportSettings } from "../server/services/reportSettings";
import ReportSettingsForm from "../components/settings/ReportSettingsForm";
import PosSettingsForm from "../components/settings/PosSettingsForm";

// /restaurant/settings/pos — Touch POS: after a dish is added, after Send,
// the theme and auto-lock; and Restaurant Reports' business day and cash
// variance limit. Needs
// Restaurant Settings.
export default async function PosSettingsPage() {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.RESTAURANT_SETTINGS);
  if (denied) return denied;

  const [settings, reports] = await Promise.all([getPosSettings(), getReportSettings()]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 620 }}>
      <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Touch POS</h1>
      <PosSettingsForm initial={settings} />
      <ReportSettingsForm initial={reports} />
    </div>
  );
}
