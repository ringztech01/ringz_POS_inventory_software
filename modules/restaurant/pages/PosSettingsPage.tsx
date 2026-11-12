import { FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getPosSettings } from "../server/queries/posScreen";
import { getDayStartMinutes } from "../server/services/reportSettings";
import DayStartForm from "../components/settings/DayStartForm";
import PosSettingsForm from "../components/settings/PosSettingsForm";

// /restaurant/settings/pos — Touch POS: after a dish is added, after Send,
// the theme and auto-lock; and the business day (Restaurant Reports). Needs
// Restaurant Settings.
export default async function PosSettingsPage() {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.RESTAURANT_SETTINGS);
  if (denied) return denied;

  const [settings, dayStart] = await Promise.all([getPosSettings(), getDayStartMinutes()]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 620 }}>
      <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Touch POS</h1>
      <PosSettingsForm initial={settings} />
      <DayStartForm initial={dayStart} />
    </div>
  );
}
