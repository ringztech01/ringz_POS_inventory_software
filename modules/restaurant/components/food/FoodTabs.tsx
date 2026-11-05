import Link from "next/link";
import { COLORS } from "@/components/layout/theme";

// The Food screen's tabs (RingzPOS Food Management design): Menu items,
// Modifiers, Recipes — each its own route.
export const FOOD_TABS = [
  { key: "items", label: "Menu items", href: "/restaurant/food/items" },
  { key: "modifiers", label: "Modifiers", href: "/restaurant/food/modifiers" },
  { key: "recipes", label: "Recipes", href: "/restaurant/food/recipes" },
] as const;

export type FoodTab = (typeof FOOD_TABS)[number]["key"];

export default function FoodTabs({ active }: { active: FoodTab }) {
  return (
    <nav aria-label="Food" style={{ display: "flex", gap: 4, background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 3 }}>
      {FOOD_TABS.map((tab) => {
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
