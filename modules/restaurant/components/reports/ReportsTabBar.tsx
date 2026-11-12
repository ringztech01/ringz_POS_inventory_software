"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";
import { filterQuery, REPORT_TABS, type ReportTabKey } from "../../lib/reportTabs";

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  const hover = useToggleState();
  return (
    <Link
      href={href}
      data-report-tab={label}
      aria-current={active ? "page" : undefined}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 44,
        padding: "0 12px",
        display: "flex",
        alignItems: "center",
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

// Restaurant Reports' tabs (the retail Reports' sub-tab look). Each tab is
// its own route; the filters in the URL go with you.
export default function ReportsTabBar({ active }: { active: ReportTabKey }) {
  const query = filterQuery(new URLSearchParams(useSearchParams().toString()));
  return (
    <nav aria-label="Reports" style={{ display: "flex", alignItems: "center", gap: 2, borderBottom: `1px solid ${COLORS.border}`, overflowX: "auto" }}>
      {REPORT_TABS.map((tab) => (
        <Tab key={tab.key} href={`${tab.href}${query}`} label={tab.label} active={tab.key === active} />
      ))}
    </nav>
  );
}
