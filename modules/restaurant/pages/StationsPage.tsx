import { FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { getStationList } from "../server/queries/stations";
import StationsPanel from "../components/stations/StationsPanel";

// /restaurant/settings/stations — the kitchen stations (where dishes are
// made; each has its tab on the kitchen display). Needs Restaurant Settings.
export default async function StationsPage() {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.RESTAURANT_SETTINGS);
  if (denied) return denied;

  const stations = await getStationList();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 }}>
      <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Stations</h1>
      <StationsPanel stations={stations} />
    </div>
  );
}
