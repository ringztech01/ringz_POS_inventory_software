"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { COLORS } from "@/components/layout/theme";
import { nameSize, showsDetail, tableRadius } from "../../lib/floorView";
import type { HeatMetric } from "../../lib/reportTables";
import type { HeatArea } from "../../server/queries/reports/tables";
import FloorRoom from "../pos/FloorRoom";

// Dim when nothing, then five teal steps up to the busiest table.
const STEPS = ["#21463F", "#1C6457", "#16836F", "#11A088", "#2FCDAF"];
const NONE = "#2A3038";
const colourOf = (share: number) => (share <= 0 ? NONE : STEPS[Math.min(STEPS.length - 1, Math.floor(share * STEPS.length - 1e-9))]);

export type HeatValues = Record<HeatMetric, Record<string, { share: number; label: string }>>;

// Restaurant Reports › By table: the floor plan coloured by each table's net
// sales or turns in the period. The tablet's own room (FloorRoom), read-only.
export default function TableHeatMap({ areas, values, defaultArea }: { areas: HeatArea[]; values: HeatValues; defaultArea: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const metric: HeatMetric = params.get("heat") === "turns" ? "turns" : "net";
  const areaId = areas.some((a) => a.id === params.get("heatArea")) ? params.get("heatArea")! : (defaultArea ?? areas[0]?.id ?? null);
  const area = areas.find((a) => a.id === areaId) ?? null;
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const pill = (active: boolean) => ({
    height: 32,
    padding: "0 12px",
    borderRadius: 999,
    border: `1px solid ${active ? COLORS.tealBorder : COLORS.borderStrong}`,
    background: active ? COLORS.tealTint : "#fff",
    color: active ? COLORS.tealDark : COLORS.text,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <section aria-label="Floor heat map" data-heat-map={metric} style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, marginRight: 8 }}>Floor heat map</h2>
        <button type="button" data-heat-metric="net" aria-pressed={metric === "net"} onClick={() => set("heat", "net")} style={pill(metric === "net")}>
          Net sales
        </button>
        <button type="button" data-heat-metric="turns" aria-pressed={metric === "turns"} onClick={() => set("heat", "turns")} style={pill(metric === "turns")}>
          Turns per day
        </button>
        <span style={{ flex: 1 }} />
        {areas.length > 1 &&
          areas.map((a) => (
            <button key={a.id} type="button" data-heat-area={a.name} aria-pressed={a.id === areaId} onClick={() => set("heatArea", a.id)} style={pill(a.id === areaId)}>
              {a.name}
            </button>
          ))}
      </div>
      {area && area.tables.length > 0 ? (
        <div style={{ height: 420, display: "flex", background: "#1B1F24", borderRadius: 10, overflow: "hidden" }}>
          <FloorRoom
            room={area.room}
            fixtures={area.fixtures}
            tables={area.tables}
            render={(table, at) => {
              const v = values[metric][table.id] ?? { share: 0, label: metric === "net" ? "₦0" : "0/day" };
              return (
                <div
                  key={table.id}
                  data-heat-table={table.name}
                  data-heat-share={Math.round(v.share * 100)}
                  title={`${table.name}: ${v.label}`}
                  style={{
                    ...at.style,
                    position: "absolute",
                    background: colourOf(v.share),
                    borderRadius: tableRadius(table.place.shape, at.widthPx),
                    border: "1px solid rgba(255,255,255,.12)",
                    color: "#fff",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                    textAlign: "center",
                  }}
                >
                  {/* Upright on a turned table, as on the tablet. */}
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: table.place.rotation ? `rotate(${-table.place.rotation}deg)` : undefined, whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: nameSize(at.widthPx), fontWeight: 700, lineHeight: 1.1 }}>{table.name}</span>
                    {showsDetail(at.widthPx) && <span style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{v.label}</span>}
                  </span>
                </div>
              );
            }}
          />
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: COLORS.slateMid }}>{area ? "This area has no tables yet." : "No dining areas yet."}</p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.slateMid }}>
        <span>None</span>
        <span style={{ width: 14, height: 10, borderRadius: 3, background: NONE }} />
        {STEPS.map((c) => (
          <span key={c} style={{ width: 22, height: 10, borderRadius: 3, background: c }} />
        ))}
        <span>Busiest</span>
        <span style={{ marginLeft: 8 }}>· each table&apos;s {metric === "net" ? "net sales" : "turns per day"} against the busiest one in the period.</span>
      </div>
    </section>
  );
}
