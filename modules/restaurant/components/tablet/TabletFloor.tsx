"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fitRoom, placeIn, shownWidth, tableRadius } from "../../lib/floorView";
import type { TableShape } from "../../lib/floorGeometry";
import { FLOOR_LEGEND, floorLabels, legendCounts, lookLabel, tableTitle, type TabletCheck, type TabletLook, type TabletTile } from "../../lib/tabletTables";
import { TABLE_STATE, T } from "./tabletTheme";
import { RequestBell } from "../floor/RequestBell";
import type { FloorRequest } from "../../lib/tableRequests";
import { useTabletClock } from "./useTabletClock";

// Tables in landscape (Part 6g Step 4; design: RingzPOS Tablet.dc.html ›
// Tablet Floor Landscape): the room exactly as the floor plan editor saved
// it (Part 7), as large as fits with its own proportions over a dot grid —
// tables at their place, size, turn and shape, fixtures as dashed outlines
// — and the side panel for the table tapped. An area with no floor plan
// shows the tiles instead (and tells a manager where to draw one).

export const LOOK_STYLE: Record<TabletLook, { bg: string; ring: string }> = {
  FREE: TABLE_STATE.FREE,
  SEATED: TABLE_STATE.SEATED,
  SENT: TABLE_STATE.SENT,
  BILL: TABLE_STATE.BILL,
  LATE: TABLE_STATE.LATE,
  RESERVED: TABLE_STATE.RESERVED,
  CLEANING: { bg: "#2A2E33", ring: "inset 0 0 0 4px #6B7178" },
};
// The side panel's header: free green and booked amber, with black text.
const PANEL_HEAD: Partial<Record<TabletLook, { bg: string; fg: string }>> = { FREE: { bg: T.ok, fg: "#000" }, RESERVED: { bg: "#F5B700", fg: "#000" } };

type Place = { x: number; y: number; w: number; h: number; rotation: number; shape: TableShape };
type Fixture = { id: string; x: number; y: number; w: number; h: number; rotation: number; label: string };

export type TabletFloorProps = {
  user: { firstName: string; initials: string; manager: boolean };
  areas: { id: string; name: string; free: string }[];
  areaId: string | null;
  areaName: string;
  tiles: TabletTile[];
  room: { widthM: number; heightM: number } | null;
  fixtures: Fixture[];
  places: Record<string, Place>;
  // Never saved in the editor: drawn in a grid by number (6g follow-up 3).
  planSaved: boolean;
  // A manager who may edit the floor plan: the link to arrange it.
  canArrange: boolean;
  // Guests waiting (6g follow-up 2): a pulsing bell on the table; tapped, `onBell`.
  bells: Map<string, FloorRequest[]>;
  onBell: () => void;
  // The open takeaways and tabs, under the stats when no table is picked.
  counter: ReactNode;
  summary: { free: number; openOrders: number; openValue: string };
  can: { book: boolean; settle: boolean };
  mineOnly: boolean;
  isDim: (tile: TabletTile) => boolean;
  working: boolean;
  onArea: (id: string) => void;
  onToggleMine: () => void;
  onSeat: (tile: TabletTile, guests: number) => void;
  onSeatBooking: (tile: TabletTile) => void;
  onClean: (tile: TabletTile) => void;
  onOpenOrder: (orderId: string) => void;
  onPrintBill: (orderId: string) => void;
  onPay: (orderId: string) => void;
  onTakeaway: () => void;
  onBarTab: () => void;
  onLock: () => void;
  // The tiles, for an area with no floor plan.
  grid: ReactNode;
};

function Room({ room, fixtures, tiles, places, selectedId, isDim, onPick, bells, onBell }: { room: { widthM: number; heightM: number }; fixtures: Fixture[]; tiles: TabletTile[]; places: Record<string, Place>; selectedId: string | null; isDim: (tile: TabletTile) => boolean; onPick: (id: string) => void; bells: Map<string, FloorRequest[]>; onBell: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setPanel({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit = panel && panel.w > 0 ? fitRoom(room, panel, 4) : null;
  return (
    <div ref={ref} data-tablet-room-panel style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {fit && fit.scale > 0 && (
        <div data-tablet-room style={{ position: "relative", width: fit.w, height: fit.h, flex: "none", backgroundColor: "#121417", backgroundImage: "radial-gradient(#2A2E33 1.5px, transparent 1.5px)", backgroundSize: `${Math.max(12, fit.scale / 2)}px ${Math.max(12, fit.scale / 2)}px`, borderRadius: 6, boxShadow: "inset 0 0 0 2px #2A2E33" }}>
          {fixtures.map((f) => (
            <div
              key={f.id}
              data-floor-fixture={f.label}
              aria-hidden
              style={{ position: "absolute", ...placeIn(f, room), border: "2px dashed #3A3F46", borderRadius: 4, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", fontSize: 13, fontWeight: 800, letterSpacing: ".12em", color: "#6B7178", whiteSpace: "nowrap", pointerEvents: "none" }}
            >
              {f.label.toUpperCase()}
            </div>
          ))}
          {tiles.map((tile) => {
            const place = places[tile.id];
            if (!place) return null;
            const widthPx = shownWidth(place, fit.scale);
            const labels = floorLabels(tile, widthPx);
            const look = LOOK_STYLE[tile.look];
            const selected = tile.id === selectedId;
            return (
              <button
                key={tile.id}
                type="button"
                className="tb-press"
                data-floor-table={tile.name}
                data-look={tile.look}
                data-width={Math.round(widthPx)}
                aria-pressed={selected}
                onClick={() => onPick(tile.id)}
                style={{ position: "absolute", ...placeIn(place, room), border: "none", borderRadius: tableRadius(place.shape, widthPx), background: look.bg, color: T.text, boxShadow: selected ? "0 0 0 5px #fff" : look.ring, opacity: isDim(tile) ? 0.25 : 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 2, zIndex: selected ? 2 : 1, fontFamily: "inherit" }}
              >
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, transform: place.rotation ? `rotate(${-place.rotation}deg)` : undefined, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: labels.big ? 30 : 22, fontWeight: 900, lineHeight: 1 }}>{tile.name}</span>
                  {labels.line1 && <span style={{ fontSize: 13, fontWeight: 800 }}>{labels.line1}</span>}
                  {labels.line2 && <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.92 }}>{labels.line2}</span>}
                </span>
              </button>
            );
          })}
          {tiles.map((tile) => {
            const place = places[tile.id];
            const requests = bells.get(tile.id);
            if (!place || !requests?.length) return null;
            const corner = bellCorner(place, room);
            return (
              <span key={`bell-${tile.id}`} style={{ position: "absolute", left: `${corner.x}%`, top: `${corner.y}%`, transform: "translate(-60%, -40%)", zIndex: 4 }}>
                <RequestBell requests={requests} tableName={tile.name} size={46} onDone={onBell} />
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Where a table's bell goes: the top right corner of what's drawn, turned
// tables included (a box turned by θ spans |w·cosθ| + |h·sinθ| across) — as
// a % of the room.
function bellCorner(place: Place, room: { widthM: number; heightM: number }): { x: number; y: number } {
  const turn = (place.rotation * Math.PI) / 180;
  const across = Math.abs(place.w * Math.cos(turn)) + Math.abs(place.h * Math.sin(turn));
  const down = Math.abs(place.w * Math.sin(turn)) + Math.abs(place.h * Math.cos(turn));
  const cx = place.x + place.w / 2;
  const cy = place.y + place.h / 2;
  return { x: ((cx + across / 2) / room.widthM) * 100, y: ((cy - down / 2) / room.heightM) * 100 };
}

const big = (bg: string, fg: string = T.text) => ({ border: "none", borderRadius: 8, background: bg, color: fg, fontWeight: 900, fontFamily: "inherit", cursor: "pointer" }) as const;

function BusyPanel({ tile, check, onCheck, can, working, onOpenOrder, onPrintBill, onPay }: { tile: TabletTile; check: TabletCheck; onCheck: (id: string) => void } & Pick<TabletFloorProps, "can" | "working" | "onOpenOrder" | "onPrintBill" | "onPay">) {
  const look = LOOK_STYLE[check.look];
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div data-panel-head={check.look} style={{ padding: "16px 20px", background: look.bg, color: T.text, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <span data-panel-title style={{ fontSize: 36, fontWeight: 900 }}>{tableTitle(tile.name)}</span>
          <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: ".06em" }}>{lookLabel({ look: check.look, reservation: null }).toUpperCase()}</span>
        </div>
        <span data-panel-meta style={{ fontSize: 17, fontWeight: 700 }}>
          {check.initials ?? "—"} · open {check.minutes} min · {check.guests} {check.guests === 1 ? "guest" : "guests"}
        </span>
      </div>
      {tile.checks.length > 1 && (
        <div style={{ display: "flex", gap: 6, padding: "10px 16px 0", flexWrap: "wrap" }}>
          {tile.checks.map((c) => (
            <button key={c.id} type="button" className="tb-press" data-panel-check={c.label} aria-pressed={c.id === check.id} onClick={() => onCheck(c.id)} style={{ ...big(c.id === check.id ? T.text : T.edge, c.id === check.id ? "#000" : T.text), height: 52, padding: "0 16px", fontSize: 16 }}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "10px 16px 16px", gap: 10 }}>
        <div data-panel-lines style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {check.lines.length === 0 && <span style={{ padding: "10px 0", fontSize: 16, fontWeight: 700, color: T.quiet }}>Nothing ordered yet.</span>}
          {check.lines.map((l) => (
            <div key={l.id} data-panel-line={l.name} style={{ display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) auto", gap: 8, padding: "10px 0", borderBottom: `1px solid ${T.edge}`, fontSize: 18, fontWeight: 800 }}>
              <span>{l.quantity}×</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
              <span data-line-state style={{ fontSize: 12, fontWeight: 900, color: T.quiet, alignSelf: "center" }}>
                {l.state}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: T.quiet }}>Total</span>
          <span data-panel-total style={{ fontSize: 34, fontWeight: 900 }}>
            {check.total}
          </span>
        </div>
        <button type="button" className="tb-press" data-open-order disabled={working} onClick={() => onOpenOrder(check.id)} style={{ ...big(T.food), height: 80, fontSize: 24 }}>
          OPEN ORDER
        </button>
        <div style={{ display: "grid", gridTemplateColumns: can.settle ? "repeat(2, minmax(0, 1fr))" : "1fr", gap: 8 }}>
          <button type="button" className="tb-press" data-print-bill disabled={working} onClick={() => onPrintBill(check.id)} style={{ ...big(T.edge), height: 64, fontSize: 18 }}>
            PRINT BILL
          </button>
          {can.settle && (
            <button type="button" className="tb-press" data-panel-pay disabled={working} onClick={() => onPay(check.id)} style={{ ...big(T.pay), height: 64, fontSize: 18 }}>
              PAY
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TabletFloor(props: TabletFloorProps) {
  const { user, areas, areaId, tiles, room, fixtures, places, summary, can, mineOnly, isDim, working } = props;
  const clock = useTabletClock();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const selected = tiles.find((t) => t.id === selectedId) ?? null;
  const check = selected ? (selected.checks.find((c) => c.id === checkId) ?? selected.checks[0] ?? null) : null;
  const counts = legendCounts(tiles);
  const late = counts.LATE;
  const head = selected ? (PANEL_HEAD[selected.look] ?? { bg: LOOK_STYLE[selected.look].bg, fg: T.text }) : null;
  const plan = !!room && tiles.some((t) => places[t.id]);

  return (
    <div data-tablet-floor style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: "88px minmax(0, 1fr) 96px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 16px", background: T.bar, minWidth: 0 }}>
        <span style={{ fontSize: 34, fontWeight: 900, padding: "0 6px" }}>Tables</span>
        {/* Four tabs fill the bar; more scroll sideways, a quarter each. */}
        <div data-floor-areas style={{ flex: 1, minWidth: 0, display: "flex", gap: 8, overflowX: areas.length > 4 ? "auto" : "hidden", scrollbarWidth: "none" }}>
          {areas.map((a) => {
            const on = a.id === areaId;
            return (
              <button key={a.id} type="button" className="tb-press" data-floor-area={a.name} aria-pressed={on} onClick={() => !on && (setSelectedId(null), props.onArea(a.id))} style={{ ...big(on ? T.text : T.button, on ? "#000" : T.text), height: 64, flex: areas.length > 4 ? "0 0 calc((100% - 24px) / 4)" : "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minWidth: 0, padding: "0 6px" }}>
                <span style={{ fontSize: 21, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                <span style={{ fontSize: 13, fontWeight: 700, opacity: 0.85 }}>{a.free}</span>
              </button>
            );
          })}
        </div>
        <span data-user-chip style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderRadius: 8, background: "#1F2226", fontSize: 19, fontWeight: 800, whiteSpace: "nowrap" }}>
          <span style={{ width: 36, height: 36, borderRadius: "50%", background: T.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{user.initials}</span>
          {user.firstName}
        </span>
        <span data-tablet-clock style={{ fontSize: 26, fontWeight: 800, padding: "0 4px", minWidth: 76, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {clock ?? ""}
        </span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 10, padding: 10, minHeight: 0 }}>
        <section style={{ background: T.raised, borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 12, minWidth: 0, minHeight: 0 }}>
          <div data-floor-legend style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
            {FLOOR_LEGEND.map((look) => (
              <span key={look} data-legend={look} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 700, color: T.soft }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: LOOK_STYLE[look].bg, boxShadow: LOOK_STYLE[look].ring.replace("4px", "2px") }} />
                {look === "RESERVED" ? "Reserved" : lookLabel({ look, reservation: null })}
                <span style={{ color: T.text, fontWeight: 900 }}>{counts[look]}</span>
              </span>
            ))}
          </div>
          {plan && room ? (
            <>
              <Room room={room} fixtures={fixtures} tiles={tiles} places={places} selectedId={selectedId} isDim={isDim} onPick={(id) => (setSelectedId(id === selectedId ? null : id), setCheckId(null))} bells={props.bells} onBell={props.onBell} />
              {!props.planSaved && props.canArrange && areaId && (
                <a data-arrange-floor href={`/restaurant/settings/floor?area=${encodeURIComponent(areaId)}`} style={{ alignSelf: "flex-end", fontSize: 15, fontWeight: 700, color: T.soft, textDecoration: "underline", padding: "4px 6px" }}>
                  Arrange in Floor plan editor
                </a>
              )}
            </>
          ) : (
            <div data-no-floor-plan style={{ flex: 1, minHeight: 0, width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
              {props.grid}
            </div>
          )}
        </section>

        <aside data-floor-panel style={{ background: T.raised, borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          {!selected || !head ? (
            <div data-panel-empty style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: 20 }}>
              <span style={{ fontSize: 28, fontWeight: 900 }}>Tap a table</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                {(
                  [
                    [String(summary.free), "Free tables"],
                    [String(summary.openOrders), "Open orders"],
                    [String(late), "Waiting long"],
                    [summary.openValue.replace(/\.00$/, ""), "Open value"],
                  ] as const
                ).map(([value, label]) => (
                  <div key={label} data-stat={label} style={{ background: T.bg, borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: value.length > 9 ? 20 : value.length > 7 ? 23 : 28, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.quiet }}>{label}</span>
                  </div>
                ))}
              </div>
              {props.counter}
            </div>
          ) : check ? (
            <BusyPanel tile={selected} check={check} onCheck={setCheckId} can={can} working={working} onOpenOrder={props.onOpenOrder} onPrintBill={props.onPrintBill} onPay={props.onPay} />
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div data-panel-head={selected.look} style={{ padding: "16px 20px", background: head.bg, color: head.fg, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span data-panel-title style={{ fontSize: 36, fontWeight: 900 }}>{tableTitle(selected.name)}</span>
                  <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: ".06em" }}>{lookLabel(selected).toUpperCase()}</span>
                </div>
                <span data-panel-meta style={{ fontSize: 17, fontWeight: 700 }}>
                  {selected.look === "RESERVED" && selected.reservation ? `${selected.reservation.guestName} · ${selected.reservation.partySize} guests` : selected.look === "CLEANING" ? "Needs cleaning" : `Ready to seat · ${selected.seats} seats`}
                </span>
              </div>
              <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                {selected.look === "FREE" && (
                  <>
                    <span style={{ fontSize: 22, fontWeight: 900 }}>How many guests?</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gridAutoRows: 76, gap: 8 }}>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <button key={n} type="button" className="tb-press" data-panel-guests={n} disabled={working} onClick={() => props.onSeat(selected, n)} style={{ ...big(T.edge), fontSize: 34 }}>
                          {n}
                        </button>
                      ))}
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 600, color: T.quiet }}>Tap a number to open the order.</span>
                  </>
                )}
                {selected.look === "RESERVED" && selected.reservation && (
                  <>
                    {can.book ? (
                      <button type="button" className="tb-press" data-panel-seat-booking disabled={working} onClick={() => props.onSeatBooking(selected)} style={{ ...big(T.teal), height: 80, fontSize: 22 }}>
                        SEAT {selected.reservation.guestName.toUpperCase()}
                      </button>
                    ) : (
                      <span style={{ fontSize: 17, fontWeight: 700, color: T.quiet }}>Seating a booking needs Manage Reservations. Ask a manager.</span>
                    )}
                    <span style={{ fontSize: 15, fontWeight: 600, color: T.quiet }}>Booked for {selected.reservation.time}.</span>
                  </>
                )}
                {selected.look === "CLEANING" && (
                  <button type="button" className="tb-press" data-panel-clean disabled={working} onClick={() => props.onClean(selected)} style={{ ...big(T.teal), height: 80, fontSize: 22 }}>
                    MARK CLEAN
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      <footer style={{ display: "grid", gridTemplateColumns: `repeat(${user.manager ? 3 : 4}, minmax(0, 1fr))`, gap: 10, padding: "12px 16px 16px", background: T.bar }}>
        {user.manager ? null : (
          <button type="button" className="tb-press" data-floor-mine aria-pressed={mineOnly} onClick={props.onToggleMine} style={{ ...big(mineOnly ? T.teal : "#1F2226"), fontSize: 21 }}>
            {mineOnly ? "MY TABLES ✓" : "MY TABLES"}
          </button>
        )}
        <button type="button" className="tb-press" data-floor-takeaway onClick={props.onTakeaway} style={{ ...big("#1F2226"), fontSize: 21 }}>
          TAKEAWAY
        </button>
        <button type="button" className="tb-press" data-floor-bar-tab onClick={props.onBarTab} style={{ ...big("#1F2226"), fontSize: 21 }}>
          BAR TAB
        </button>
        <button type="button" className="tb-press" data-floor-lock disabled={working} onClick={props.onLock} style={{ ...big(T.lockBg, T.lockFg), fontSize: 21 }}>
          LOCK
        </button>
      </footer>
    </div>
  );
}
