"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { COLORS } from "@/components/layout/theme";

// The prep-time report's station filter: writes ?station= (absent = every
// station), keeping the dates.
export default function PrepStationFilter({ stations, value }: { stations: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("station", next);
    else params.delete("station");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: COLORS.text }}>
      Station :
      <select
        aria-label="Station"
        value={value}
        onChange={(event) => change(event.target.value)}
        style={{ height: 38, minWidth: 180, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, padding: "0 10px", fontSize: 13.5, background: "#fff", color: COLORS.ink }}
      >
        <option value="">All stations</option>
        {stations.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
