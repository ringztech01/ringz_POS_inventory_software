"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useToggleState } from "@/components/layout/hooks";
import { findActiveChild } from "@/components/layout/nav-data";
import { COLORS } from "@/components/layout/theme";

type Tab = { label: string; href: string };

function NavTab({ tab, active }: { tab: Tab; active: boolean }) {
  const hover = useToggleState();
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 34,
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
        borderRadius: 7,
        background: active ? COLORS.tealTint : "transparent",
        color: active || hover.value ? COLORS.tealDark : COLORS.slate,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {tab.label}
    </Link>
  );
}

// The restaurant section tabs. Active: the most specific tab matching the
// path, so /restaurant/floor lights Floor, not Dashboard (/restaurant).
export default function RestaurantNav({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname() || "";
  const active = findActiveChild(pathname, tabs)?.href;

  return (
    <nav aria-label="Restaurant" style={{ display: "flex", gap: 4 }}>
      {tabs.map((tab) => (
        <NavTab key={tab.href} tab={tab} active={tab.href === active} />
      ))}
    </nav>
  );
}
