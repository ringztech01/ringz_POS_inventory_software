import Link from "next/link";
import { COLORS } from "@/components/layout/theme";

// Food › Modifiers' two views: the groups, and the modifiers in a group.
export type ModifierView = "groups" | "options";

export default function ModifierViews({ active }: { active: ModifierView }) {
  const views = [
    { key: "groups", label: "Groups", href: "/restaurant/food/modifiers" },
    { key: "options", label: "Modifiers", href: "/restaurant/food/modifiers?view=options" },
  ] as const;
  return (
    <nav aria-label="Modifier views" style={{ display: "flex", gap: 18, borderBottom: `1px solid ${COLORS.border}` }}>
      {views.map((view) => {
        const on = view.key === active;
        return (
          <Link
            key={view.key}
            href={view.href}
            aria-current={on ? "page" : undefined}
            style={{
              padding: "8px 2px",
              marginBottom: -1,
              borderBottom: `2px solid ${on ? COLORS.teal : "transparent"}`,
              color: on ? COLORS.tealDark : COLORS.slate,
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {view.label}
          </Link>
        );
      })}
    </nav>
  );
}
