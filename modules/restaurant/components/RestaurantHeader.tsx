import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { COLORS, FONTS } from "@/components/layout/theme";
import { restaurantModule } from "../manifest";
import RestaurantNav from "./RestaurantNav";
import { HEADER_ACTIONS_ID } from "../lib/headerSlot";

// The top bar shared by every RingzPOS restaurant design: "RingzPOS /
// Restaurant" and the section nav. It sits flush under the app's top bar —
// the negative margin cancels the dashboard <main>'s 32px padding. Tabs the
// user has no permission for are left out (UX only; each page checks). The
// right end is filled by the page (HeaderActions).
export default async function RestaurantHeader() {
  const { permissions } = await getCurrentUserPermissions();
  const tabs = restaurantModule.nav
    .filter((tab) => tab.header !== false && tab.permissions.some((permission) => permissions.has(permission)))
    .map(({ label, href }) => ({ label, href }));

  return (
    <header
      style={{
        margin: "-32px -32px 0",
        height: 60,
        flex: "0 0 auto",
        background: "#fff",
        borderBottom: `1px solid ${COLORS.border}`,
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "0 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: COLORS.teal,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONTS.display,
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          R
        </div>
        <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.slateLight }}>RingzPOS /</span>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: COLORS.ink }}>Restaurant</span>
      </div>
      <RestaurantNav tabs={tabs} />
      <div id={HEADER_ACTIONS_ID} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }} />
    </header>
  );
}
