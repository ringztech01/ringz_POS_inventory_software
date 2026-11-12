"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { fitRoom, placeIn, shownWidth } from "../../lib/floorView";
import type { FloorFixtureView, FloorPlace } from "../../server/queries/floor";

// The service view's room (Part 7 Step 6): the area drawn from the floor
// plan editor's metres, as large as fits this panel with the room's own
// proportions, tables and fixtures where they were put and turned as they
// were. Tables are drawn by the screen (render), given their place and how
// wide they show.
export default function FloorRoom<T extends { id: string; place: FloorPlace }>({
  room,
  fixtures,
  tables,
  render,
}: {
  room: { widthM: number; heightM: number };
  fixtures: FloorFixtureView[];
  tables: T[];
  render: (table: T, at: { style: CSSProperties; widthPx: number }) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setPanel({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit = panel ? fitRoom(room, panel) : null;
  return (
    <div
      ref={ref}
      data-tables-view="floor"
      style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", backgroundImage: "radial-gradient(#2A3038 1px, transparent 1px)", backgroundSize: "24px 24px" }}
    >
      {fit && fit.scale > 0 && (
        <div data-floor-room style={{ position: "relative", width: fit.w, height: fit.h, flexShrink: 0, borderRadius: 4, boxShadow: "inset 0 0 0 1px #2C323A" }}>
          {fixtures.map((f) => (
            <div
              key={f.id}
              data-floor-fixture={f.label}
              aria-hidden
              style={{
                position: "absolute",
                ...placeIn(f, room),
                border: "1px dashed #3A424C",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                fontSize: Math.max(9, Math.min(12, Math.round(f.h * fit.scale * 0.3))),
                fontWeight: 700,
                letterSpacing: ".1em",
                color: "#5A636C",
                textAlign: "center",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {f.label.toUpperCase()}
            </div>
          ))}
          {tables.map((table) => render(table, { style: { position: "absolute", ...placeIn(table.place, room) }, widthPx: shownWidth(table.place, fit.scale) }))}
        </div>
      )}
    </div>
  );
}
