"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { COLORS } from "@/components/layout/theme";
import { DASHBOARD_RANGES, type DashboardRangeKey } from "../../lib/dashboard";

// The dashboard's date filter (header, right): Today / Yesterday / Last 7
// days, kept in ?range= so the page reads it on the server.
export default function RangeSelect({ value }: { value: DashboardRangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label="Date range"
      value={value}
      aria-busy={isPending}
      onChange={(event) => {
        const range = event.target.value;
        startTransition(() => router.replace(range === "today" ? pathname : `${pathname}?range=${range}`, { scroll: false }));
      }}
      style={{ height: 36, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13, background: "#fff", opacity: isPending ? 0.6 : 1 }}
    >
      {(Object.keys(DASHBOARD_RANGES) as DashboardRangeKey[]).map((key) => (
        <option key={key} value={key}>
          {DASHBOARD_RANGES[key]}
        </option>
      ))}
    </select>
  );
}
