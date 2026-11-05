import Link from "next/link";
import { COLORS } from "@/components/layout/theme";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { visibleFoodTabs, type FoodTab } from "../../lib/foodTabs";

// The Food screen's tabs (lib/foodTabs.ts): the ones this user may open.
// A server component — a client panel gets it as a prop.
export default async function FoodTabs({ active }: { active: FoodTab }) {
  const { permissions } = await getCurrentUserPermissions();
  return (
    <nav aria-label="Food" style={{ display: "flex", gap: 4, background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 3 }}>
      {visibleFoodTabs(permissions).map((tab) => {
        const on = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 6,
              background: on ? COLORS.teal : "transparent",
              color: on ? "#fff" : COLORS.slate,
              fontSize: 13,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              textDecoration: "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
