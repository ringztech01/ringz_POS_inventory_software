"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

// The report tabs (RingzPOS Reports.dc.html). Each tab is a real route; the
// active one is derived from the pathname.
export const REPORT_TABS = [
  { href: "/reports/warehouse", label: "Warehouse Reports" },
  { href: "/reports/sale", label: "Sale Reports" },
  { href: "/reports/stock", label: "Stock Reports" },
  { href: "/reports/purchase", label: "Purchase Reports" },
  { href: "/reports/top-selling-products", label: "Top Selling Products Reports" },
] as const;

const MORE_HREF = "/reports/more";

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  const hover = useToggleState();

  return (
    <Link
      href={href}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 60,
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        // Longhands only (the colour changes on hover/active).
        borderBottomWidth: 2.5,
        borderBottomStyle: "solid",
        borderBottomColor: active ? COLORS.teal : "transparent",
        fontSize: 13.5,
        fontWeight: active ? 600 : 500,
        color: active || hover.value ? COLORS.teal : COLORS.slate,
        whiteSpace: "nowrap",
        textDecoration: "none",
        transition: "color .12s",
      }}
    >
      {label}
    </Link>
  );
}

function MoreTab({ active }: { active: boolean }) {
  const hover = useToggleState();

  return (
    <Link
      href={MORE_HREF}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 60,
        padding: "0 10px",
        display: "flex",
        alignItems: "center",
        gap: 5,
        borderBottomWidth: 2.5,
        borderBottomStyle: "solid",
        borderBottomColor: active ? COLORS.teal : "transparent",
        fontSize: 13.5,
        fontWeight: active ? 600 : 500,
        color: active || hover.value ? COLORS.teal : COLORS.slate,
        whiteSpace: "nowrap",
        textDecoration: "none",
      }}
    >
      More
      <ChevronDown size={14} strokeWidth={1.8} />
    </Link>
  );
}

// Rendered in the Topbar on /reports pages, in place of the breadcrumb and
// global search (as the design draws it).
export default function ReportTabs() {
  const pathname = usePathname() || "";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, overflowX: "auto" }}>
      {REPORT_TABS.map((tab) => (
        <Tab key={tab.href} href={tab.href} label={tab.label} active={isActive(pathname, tab.href)} />
      ))}
      <MoreTab active={isActive(pathname, MORE_HREF)} />
    </div>
  );
}
