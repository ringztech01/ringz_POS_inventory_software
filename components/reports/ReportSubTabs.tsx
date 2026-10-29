"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS } from "@/components/layout/theme";

function SubTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  const hover = useToggleState();

  return (
    <Link
      href={href}
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

// Sub-tabs inside a report card (?tab=). Switching keeps the warehouse and
// date range, and starts the new table from page 1 with no search.
export default function ReportSubTabs({
  tabs,
  active,
}: {
  tabs: readonly { key: string; label: string }[];
  active: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefFor = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    params.delete("q");
    params.delete("page");
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 20px 0",
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      {tabs.map((tab) => (
        <SubTab key={tab.key} href={hrefFor(tab.key)} label={tab.label} active={tab.key === active} />
      ))}
    </div>
  );
}
