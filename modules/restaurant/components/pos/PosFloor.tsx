"use client";

import { Fragment, useEffect, useState, useSyncExternalStore, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Lock, Maximize, Minimize } from "lucide-react";
import PrintButton from "@/components/hardware/PrintButton";
import { useFullscreen } from "@/components/pos/use-fullscreen";
import { nameSize, showsDetail, tableRadius } from "../../lib/floorView";
import { noTableLabel } from "../../lib/orderLines";
import { staffBadge } from "../../lib/posSpeed";
import { pickableTables, type MoveMode } from "../../lib/tableMoves";
import { formatAppTime } from "../../lib/time";
import { TOUCH } from "../../lib/theme";
import { markTableClean, mergeOrderInto, moveOrderToTable, newTableCheck, openTable } from "../../server/actions/floor";
import { printBillAction } from "../../server/actions/printing";
import { seatReservation } from "../../server/actions/reservations";
import type { FloorData, FloorTable, FloorTarget } from "../../server/queries/floor";
import type { CounterOrder, PosSettings, PosStaff } from "../../server/queries/posScreen";
import FloorPolling from "../floor/FloorPolling";
import { GuestOrderBadge, guestOrderByOrder, guestOrderByTable, RequestBell, requestsByTable, TakeawayBag, useGuestOrderToasts, useRequestToasts } from "../floor/RequestBell";
import GuestLinesPanel from "../order/GuestLinesPanel";
import { confirmGuestLinesAction, rejectGuestLinesAction } from "../../server/actions/guestOrders";
import TablePickerModal from "../floor/TablePickerModal";
import BarTabDialog from "./BarTabDialog";
import FunctionBar, { type FnKey } from "./FunctionBar";
import MoreMenu from "./MoreMenu";
import PosSession, { usePosSession } from "./PosSession";
import { useServiceRoutes } from "../ServiceRoutes";
import FloorRoom from "./FloorRoom";
import { BackOfficeKey } from "./PosHeader";
import type { PosSessionInfo } from "../../server/posSessionInfo";
import TouchButton from "./TouchButton";

export type FromOrder = { id: string; tableName: string | null; type: CounterOrder["type"]; tabName: string | null };
export type FloorCan = { orders: boolean; book: boolean; kitchen: boolean; settle: boolean };

// A table's look (the POS Tables design): free, the order's stage when it's
// taken, reserved, or waiting to be cleaned.
type Look = "free" | "seated" | "sent" | "bill" | "late" | "resv" | "clean";
const LOOK: Record<Look, { label: string; bg: string; fg: string; ring: string }> = {
  free: { label: "Free", bg: "#2B3139", fg: "#fff", ring: "inset 0 0 0 2px #3DD68C" },
  seated: { label: "Seated", bg: "#2457A6", fg: "#fff", ring: "none" },
  sent: { label: "Food sent", bg: "#C2611A", fg: "#fff", ring: "none" },
  bill: { label: "Bill printed", bg: "#6B3FA0", fg: "#fff", ring: "none" },
  late: { label: "Waiting long", bg: "#B3261E", fg: "#fff", ring: "inset 0 0 0 3px #FF8A8D" },
  resv: { label: "Reserved", bg: "#3A3F46", fg: "#E0E4E8", ring: "inset 0 0 0 2px #F2B233" },
  clean: { label: "Cleaning", bg: "#3A3F46", fg: "#C9D0D6", ring: "inset 0 0 0 2px #6D777A" },
};
const LOOKS = Object.keys(LOOK) as Look[];
const STAGE_LOOK = { SEATED: "seated", SENT: "sent", BILL: "bill", LATE: "late" } as const;

function lookOf(table: FloorTable): Look {
  if (table.status === "Occupied" && table.order) return STAGE_LOOK[table.order.stage];
  if (table.status === "Reserved") return "resv";
  if (table.status === "Cleaning") return "clean";
  return "free";
}


// A line's kitchen state on the side panel.
const LINE_STATE: Record<string, [string, string]> = {
  NEW: ["NEW", "#9A5B00"],
  PENDING: ["SENT", "#2457A6"],
  PREPARING: ["PREPARING", "#C2611A"],
  READY: ["READY", "#0F7D6A"],
  SERVED: ["SERVED", "#13804A"],
};

// This screen's own settings, remembered on the till: Floor or Grid, My tables.
const VIEW_KEY = "ringzpos.tables.view";
const MINE_KEY = "ringzpos.tables.mine";
const prefListeners = new Set<() => void>();
const subscribePref = (l: () => void) => {
  prefListeners.add(l);
  return () => {
    prefListeners.delete(l);
  };
};
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
  prefListeners.forEach((l) => l());
}

function subscribeClock(onChange: () => void) {
  const timer = setInterval(onChange, 5_000);
  return () => clearInterval(timer);
}

// A table on the tables screen. Floor view (Part 7 Step 6): where the floor
// plan editor put it (`at`: its place in the room and how wide it shows),
// its own shape, turned as it's turned — the number stays upright; under
// 64 px wide just the number. Grid view: the classic card.
function TableTile({
  table,
  view,
  selected,
  dim,
  onTap,
  at,
}: {
  table: FloorTable;
  view: "floor" | "grid";
  selected: boolean;
  dim: boolean;
  onTap: () => void;
  at?: { style: CSSProperties; widthPx: number };
}) {
  const look = LOOK[lookOf(table)];
  const order = table.order;
  // A training order on it (Step 7f).
  const training = table.checks.some((c) => c.training) || !!order?.training;
  const trainingTag = training ? (
    <span data-training-tag style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".06em", color: "#3B2A00", background: "#F2B233", padding: "1px 5px", borderRadius: 3 }}>
      TRAINING
    </span>
  ) : null;
  const busy = !!order;
  const who = order?.waiterName ? staffBadge(order.waiterName).initials : "—";
  const shared = table.checks.length > 1;
  const line1 = busy && shared ? `${table.checks.length} checks · ${Math.max(...table.checks.map((c) => c.minutes))}m` : busy ? `${who} · ${order.minutes}m` : table.status === "Reserved" && table.reservation ? table.reservation.time : table.status === "Cleaning" ? "Cleaning" : `${table.seats} seats`;
  const amount = busy && shared ? table.checksTotal.replace(/\.00$/, "") : busy && order.lines.length > 0 ? order.total.replace(/\.00$/, "") : "";
  const ring = selected ? `0 0 0 4px #fff, 0 0 0 7px ${look.bg}` : look.ring;
  const common = {
    background: look.bg,
    color: look.fg,
    pressedBackground: undefined,
    onClick: onTap,
    "data-floor-table": table.name,
    "data-look": lookOf(table),
    "aria-pressed": selected,
    "aria-label": `Table ${table.name} — ${look.label}`,
  };
  if (view === "grid")
    return (
      <TouchButton {...common} style={{ boxShadow: ring, opacity: dim ? 0.3 : 1, padding: "10px 12px", display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "stretch", textAlign: "left" }}>
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: TOUCH.display, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{table.name}</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{table.seats} seats</span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          {look.label}
          {trainingTag}
        </span>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 6, fontFamily: TOUCH.mono, fontSize: 12, fontWeight: 600, opacity: 0.92 }}>
          <span>{line1}</span>
          <span>{amount}</span>
        </span>
      </TouchButton>
    );
  const widthPx = at?.widthPx ?? 120;
  const detail = showsDetail(widthPx);
  const turn = table.place.rotation;
  return (
    <TouchButton
      {...common}
      data-detail={detail ? "" : undefined}
      style={{ ...at?.style, borderRadius: tableRadius(table.place.shape, widthPx), boxShadow: ring, opacity: dim ? 0.3 : 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 2, zIndex: selected ? 2 : 1 }}
    >
      <span data-table-label style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, transform: turn ? `rotate(${-turn}deg)` : undefined, whiteSpace: "nowrap" }}>
        <span style={{ fontFamily: TOUCH.display, fontSize: nameSize(widthPx), fontWeight: 700, lineHeight: 1, textAlign: "center" }}>{table.name}</span>
        {trainingTag}
        {detail && <span style={{ fontSize: 12, fontWeight: 700 }}>{line1}</span>}
        {detail && amount && <span style={{ fontFamily: TOUCH.mono, fontSize: 11, fontWeight: 600, opacity: 0.9 }}>{amount}</span>}
      </span>
    </TouchButton>
  );
}

// The touch POS's tables screen (the POS Tables design), full screen from
// Tables, F1 or Dine-in: the area tabs ("7/12 free"), My tables, Floor or
// Grid; the tables in their colours (free, seated, food sent, bill printed,
// waiting long, reserved, cleaning) with the waiter, minutes open and the
// total; the open takeaways and tabs; the side panel for the table tapped
// — a free one asks how many guests and opens the order, a busy one shows
// its lines with Open order / Print bill / Pay, a reserved one seats the
// booking. Along the bottom: Takeaway, Bar tab, Move, Merge, Reservations,
// Kitchen, More… and LOCK.
function Floor({ floor, counter, from, can, prebill }: { floor: FloorData; counter: CounterOrder[]; from: FromOrder | null; can: FloorCan; prebill: string | null }) {
  const router = useRouter();
  const session = usePosSession();
  const fullscreen = useFullscreen();
  const clock = useSyncExternalStore(subscribeClock, () => formatAppTime(new Date()), () => "");
  const view = useSyncExternalStore(subscribePref, () => (readPref(VIEW_KEY) === "grid" ? "grid" : "floor"), () => "floor");
  const mine = useSyncExternalStore(subscribePref, () => readPref(MINE_KEY) === "1", () => false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // On a shared table: the check picked in the panel (none: its first).
  const [checkId, setCheckId] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [picking, setPicking] = useState<MoveMode | null>(null);
  const [more, setMore] = useState(false);
  const [working, startWork] = useTransition();
  const routes = useServiceRoutes();
  const back = from ? routes.order(from.id) : routes.pos;
  const badge = staffBadge(session.userName);
  const selected = floor.tables.find((t) => t.id === selectedId) ?? null;
  const check = selected ? (selected.checks.find((c) => c.id === checkId) ?? selected.checks[0] ?? null) : null;
  const pickTable = (id: string | null) => {
    setSelectedId(id);
    setCheckId(null);
  };
  const area = floor.areas.find((a) => a.id === floor.areaId) ?? null;
  // Guests' Call waiter / Request bill (Part 8 Step 6): a bell on the table,
  // a toast for its waiter.
  const bells = requestsByTable(floor.requests);
  useRequestToasts(floor.requests, session.userId || null, floor.areaId);
  // Guests' orders from the menu (Step 7): a bag on the table, a toast.
  const guestBadges = guestOrderByTable(floor.guestOrders);
  const counterBadges = guestOrderByOrder(floor.guestOrders);
  useGuestOrderToasts(floor.guestOrders, session.userId || null, floor.areaId);

  useEffect(() => {
    router.prefetch(back);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"], [role="menu"]')) router.push(back);
      if (event.key === "F1") event.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, back]);

  const areaHref = (id: string) => routes.tables({ areaId: id, from: from?.id });
  const counts = Object.fromEntries(LOOKS.map((l) => [l, floor.tables.filter((t) => lookOf(t) === l).length])) as Record<Look, number>;
  const goToOrder = (id: string, pay = false) => router.push(routes.order(id, { pay }));

  function open(table: FloorTable, guests: number) {
    if (!can.orders) return void toast.error("Needs the Manage Orders permission.");
    startWork(async () => {
      const result = await openTable(table.id, guests);
      if (result.ok) return goToOrder(result.orderId);
      toast.error(result.error);
      if (result.orderId) goToOrder(result.orderId);
      else router.refresh();
    });
  }
  // Another guest at this table, on their own check.
  function newCheck(table: FloorTable, name: string) {
    if (!can.orders) return void toast.error("Needs the Manage Orders permission.");
    startWork(async () => {
      const result = await newTableCheck({ tableId: table.id, guests: 1, ...(name ? { name } : {}) });
      if (result.ok) {
        setNaming(false);
        return goToOrder(result.orderId);
      }
      toast.error(result.error);
      router.refresh();
    });
  }
  function seat(table: FloorTable) {
    const booking = table.reservation;
    if (!booking) return;
    if (!can.book) return void toast.error("Needs the Manage Reservations permission.");
    startWork(async () => {
      const result = await seatReservation(booking.id);
      if (result.ok) {
        toast.success(`${booking.guestName} seated. Order ${result.orderRef} is open.`);
        goToOrder(result.orderId);
      } else {
        toast.error(result.error);
        router.refresh();
      }
    });
  }
  function clean(table: FloorTable) {
    startWork(async () => {
      const result = await markTableClean(table.id);
      if (result.ok) toast.success(`${table.name} is clean and free.`);
      else toast.error(result.error);
      router.refresh();
    });
  }
  async function moveOrMerge(target: FloorTarget): Promise<boolean> {
    const order = check;
    if (!order || !selected || !picking) return false;
    const result =
      picking === "move"
        ? await moveOrderToTable({ orderId: order.id, version: order.version, tableId: target.id })
        : await mergeOrderInto({ orderId: order.id, version: order.version, targetOrderId: target.orderId });
    if (result.ok) {
      toast.success("targetRef" in result ? `${selected.name} merged into ${result.targetRef} at ${target.name}.` : `${order.ref} moved to ${target.name}.`);
      pickTable(null);
      return true;
    }
    toast.error(result.error);
    if (result.stale) router.refresh();
    return false;
  }
  // A guest's held lines, confirmed or rejected from the side panel.
  function guestDecision(order: { id: string; version: number }, lineIds: string[], confirm: boolean) {
    startWork(async () => {
      try {
        const result = confirm ? await confirmGuestLinesAction({ orderId: order.id, version: order.version, lineIds }) : await rejectGuestLinesAction({ orderId: order.id, lineIds });
        if (result.ok) toast.success(confirm ? (lineIds.length === 1 ? "Guest line confirmed. Send it from the order." : `${lineIds.length} guest lines confirmed. Send them from the order.`) : lineIds.length === 1 ? "Guest line rejected." : `${lineIds.length} guest lines rejected.`);
        else toast.error(result.error);
      } catch {
        toast.error("Couldn't reach the server. Check the connection and try again.");
      }
      router.refresh();
    });
  }
  const pick = (mode: MoveMode) => {
    if (!can.orders) return void toast.error("Needs the Manage Orders permission.");
    if (!check) return void toast(mode === "move" ? "Tap a table with an order, then Move table." : "Tap a table with an order, then Merge.");
    setPicking(mode);
  };

  const left: FnKey[] = [
    { label: "Takeaway", onClick: session.newTakeaway, hidden: !can.orders },
    { label: "Bar tab", onClick: session.openBarTab, hidden: !can.orders },
    { label: "Move table", onClick: () => pick("move"), hidden: !can.orders },
    { label: "Merge", onClick: () => pick("merge"), hidden: !can.orders },
  ];
  const right: FnKey[] = [
    { label: "Reservations", onClick: () => router.push("/restaurant/tables"), hidden: !can.book },
    { label: "Kitchen", onClick: () => router.push("/restaurant/kitchen"), hidden: !can.kitchen },
    {
      label: "More…",
      onClick: () => setMore((shown) => !shown),
      popover: more ? (
        <MoreMenu
          onClose={() => setMore(false)}
          items={[
            { label: from ? `Back to ${from.tableName ? `Table ${from.tableName}` : noTableLabel(from.type, from.tabName)}` : "Back to the POS", onClick: () => router.push(back) },
            // This till's cash-up (Part 6f Step 7b).
            { label: "Cash up", onClick: () => router.push("/pos/cash-up"), hidden: !can.settle },
            { label: "Back office", onClick: session.exit, hidden: !session.leaveHref },
          ]}
        />
      ) : null,
    },
    { label: "LOCK", tone: "lock", onClick: session.lock },
  ];

  const segment = { display: "flex", gap: 4, background: TOUCH.key, padding: 3, borderRadius: TOUCH.radius, flexShrink: 0 } as const;
  const look = selected ? LOOK[lookOf(selected)] : null;

  return (
    <div data-pos-floor style={{ position: "fixed", inset: 0, display: "grid", gridTemplateRows: "52px minmax(0,1fr) 78px", background: TOUCH.frame, color: TOUCH.text, overflow: "hidden", userSelect: "none", lineHeight: "normal" }}>
      <FloorPolling />
      <header data-pos-header style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", background: TOUCH.header, borderBottom: `1px solid ${TOUCH.line}`, minWidth: 0, whiteSpace: "nowrap" }}>
        <span style={{ fontFamily: TOUCH.display, fontWeight: 700, fontSize: 18 }}>RingzPOS</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: TOUCH.doneInk, background: TOUCH.doneBg, padding: "3px 7px", borderRadius: 3 }}>RESTAURANT</span>
        <nav aria-label="Areas" style={{ ...segment, marginLeft: 10, minWidth: 0, overflowX: "auto", flexShrink: 1, scrollbarWidth: "none" }}>
          {floor.areas.map((a) => {
            const on = a.id === floor.areaId;
            return (
              <TouchButton
                key={a.id}
                data-area={a.name}
                aria-current={on ? "page" : undefined}
                background={on ? TOUCH.teal : "transparent"}
                color={on ? "#fff" : TOUCH.textDim}
                pressedBackground={on ? undefined : TOUCH.keyDown}
                onClick={() => {
                  pickTable(null);
                  router.replace(areaHref(a.id), { scroll: false });
                }}
                style={{ height: 34, padding: "0 16px", borderRadius: 3, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}
              >
                {a.name}
                {a.layout && (
                  <span data-area-layout title="Event layout on this floor" style={{ fontSize: 11, fontWeight: 700, color: TOUCH.ink, background: "#F2B233", padding: "2px 6px", borderRadius: 3 }}>
                    {a.layout}
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.8 }}>
                  {a.free}/{a.total} free
                </span>
              </TouchButton>
            );
          })}
        </nav>
        <div style={{ flex: 1 }} />
        <TouchButton data-my-tables aria-pressed={mine} background={mine ? TOUCH.teal : TOUCH.key} onClick={() => writePref(MINE_KEY, mine ? "0" : "1")} style={{ height: 38, padding: "0 14px", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
          My tables
        </TouchButton>
        <div role="group" aria-label="View" style={segment}>
          {(["floor", "grid"] as const).map((v) => (
            <TouchButton key={v} data-view={v} aria-pressed={view === v} background={view === v ? TOUCH.teal : "transparent"} pressedBackground={view === v ? undefined : TOUCH.keyDown} onClick={() => writePref(VIEW_KEY, v)} style={{ height: 32, padding: "0 12px", borderRadius: 3, fontSize: 13, fontWeight: 700 }}>
              {v === "floor" ? "Floor" : "Grid"}
            </TouchButton>
          ))}
        </div>
        <TouchButton data-pos-user aria-label={`${session.userName} — switch user`} title="Switch user (PIN)" background={TOUCH.key} onClick={session.openSwitch} style={{ height: 38, padding: "0 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, maxWidth: 190, flexShrink: 0 }}>
          <span aria-hidden style={{ width: 26, height: 26, borderRadius: "50%", background: TOUCH.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
            {badge.initials}
          </span>
          <span data-pos-user-name style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{badge.short}</span>
          <Lock size={15} strokeWidth={1.8} color={TOUCH.textDim} style={{ flexShrink: 0 }} />
        </TouchButton>
        <span data-pos-clock style={{ fontFamily: TOUCH.display, fontSize: 18, fontWeight: 600, paddingLeft: 4, minWidth: 50, textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {clock}
        </span>
        <TouchButton data-pos-fullscreen aria-label={fullscreen.active ? "Leave full screen" : "Full screen"} title={fullscreen.active ? "Leave full screen" : "Full screen"} background={TOUCH.key} onClick={() => void fullscreen.toggle()} style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {fullscreen.active ? <Minimize size={17} strokeWidth={2} /> : <Maximize size={17} strokeWidth={2} />}
        </TouchButton>
        <BackOfficeKey />
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: TOUCH.gap, padding: TOUCH.gap, minHeight: 0 }}>
        <section aria-label="Tables" style={{ background: "#171A1E", borderRadius: TOUCH.radius, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <div aria-label="Legend" style={{ display: "flex", gap: 14, padding: "10px 14px", borderBottom: `1px solid ${TOUCH.line}`, flexWrap: "wrap", flexShrink: 0 }}>
            {LOOKS.filter((l) => l !== "clean" || counts.clean > 0).map((l) => (
              <span key={l} data-legend={l} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "#C9D0D6" }}>
                <span aria-hidden style={{ width: 14, height: 14, borderRadius: 3, background: LOOK[l].bg, boxShadow: LOOK[l].ring }} />
                {LOOK[l].label}
                <span style={{ color: TOUCH.muted }}>{counts[l]}</span>
              </span>
            ))}
          </div>
          {counter.length > 0 && (
            <div aria-label="Takeaways and tabs" data-counter-orders style={{ display: "flex", gap: 6, padding: "8px 14px", borderBottom: `1px solid ${TOUCH.line}`, overflowX: "auto", flexShrink: 0 }}>
              {counter.map((o) => (
                <div key={o.id} style={{ position: "relative", display: "flex", flexShrink: 0, paddingTop: counterBadges.has(o.id) ? 6 : 0 }}>
                  <TouchButton
                    data-counter-order={o.label}
                    data-counter-id={o.id}
                    background={o.type === "BAR_TAB" ? TOUCH.bar : TOUCH.teal}
                    onClick={() => goToOrder(o.id)}
                    style={{ height: 44, padding: "0 12px", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", gap: 1, flexShrink: 0 }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                      {o.type === "TAKEAWAY" && <TakeawayBag size={15} />}
                      {o.label}
                    </span>
                    <span style={{ fontFamily: TOUCH.mono, fontSize: 11, fontWeight: 600, opacity: 0.9 }}>
                      {o.ref} · {o.lines} {o.lines === 1 ? "item" : "items"} · {o.open}
                      {o.note ? ` · ${o.note}` : ""}
                    </span>
                  </TouchButton>
                  {/* A guest's lines from a QR point waiting (Part 8 Step 8). */}
                  <GuestOrderBadge order={counterBadges.get(o.id)} onOpen={(id) => goToOrder(id)} size={26} style={{ position: "absolute", top: -4, right: -6 }} />
                </div>
              ))}
            </div>
          )}
          {floor.tables.length === 0 ? (
            <p style={{ margin: 0, padding: 24, fontSize: 15, color: TOUCH.textDim }}>
              {floor.areas.length === 0 ? "No dining areas yet. Add areas and tables on Restaurant › Tables." : "No tables in this area yet."}
            </p>
          ) : view === "floor" && floor.room ? (
            <FloorRoom
              room={floor.room}
              fixtures={floor.fixtures}
              tables={floor.tables}
              render={(table, at) => (
                <Fragment key={table.id}>
                  <TableTile table={table} view="floor" at={at} selected={table.id === selectedId} dim={mine && !!table.order && table.order.waiterId !== session.userId} onTap={() => pickTable(table.id === selectedId ? null : table.id)} />
                  {/* On the table's top-right corner (as placed, before any turn). */}
                  <RequestBell
                    requests={bells.get(table.id) ?? []}
                    tableName={table.name}
                    size={34}
                    style={{ position: "absolute", left: `calc(${at.style.left} + ${at.style.width})`, top: at.style.top, transform: "translate(-65%, -35%)" }}
                  />
                  <GuestOrderBadge order={guestBadges.get(table.id)} onOpen={(id) => goToOrder(id)} size={34} style={{ position: "absolute", left: at.style.left, top: at.style.top, transform: "translate(-35%, -35%)" }} />
                </Fragment>
              )}
            />
          ) : (
            <div data-tables-view="grid" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gridAutoRows: 118, gap: TOUCH.gap, padding: 8, alignContent: "start" }}>
              {floor.tables.map((table) => (
                <div key={table.id} style={{ position: "relative", display: "grid", minWidth: 0 }}>
                  <TableTile table={table} view="grid" selected={table.id === selectedId} dim={mine && !!table.order && table.order.waiterId !== session.userId} onTap={() => pickTable(table.id === selectedId ? null : table.id)} />
                  <RequestBell requests={bells.get(table.id) ?? []} tableName={table.name} size={34} style={{ position: "absolute", top: -6, right: -6 }} />
                  <GuestOrderBadge order={guestBadges.get(table.id)} onOpen={(id) => goToOrder(id)} size={34} style={{ position: "absolute", top: -6, left: -6 }} />
                </div>
              ))}
            </div>
          )}
        </section>

        <aside aria-label="Table details" data-table-panel style={{ background: TOUCH.check, color: TOUCH.ink, borderRadius: TOUCH.radius, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {!selected || !look ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: 20 }}>
              <span style={{ fontFamily: TOUCH.display, fontSize: 20, fontWeight: 700 }}>Tap a table</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
                {[
                  [String(floor.summary.free), "Free tables"],
                  [String(floor.summary.openOrders), "Open orders"],
                  [String(floor.summary.guests), "Guests seated"],
                  [floor.summary.openValue.replace(/\.00$/, ""), "Open value"],
                ].map(([value, label]) => (
                  <div key={label} data-stat={label} style={{ background: TOUCH.strip, borderRadius: TOUCH.radius, padding: 12, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontFamily: TOUCH.display, fontSize: 24, fontWeight: 700, overflowWrap: "anywhere" }}>{value}</span>
                    <span style={{ fontSize: 13, color: TOUCH.inkDim }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ padding: "14px 16px", background: look.bg, color: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span data-panel-title style={{ fontFamily: TOUCH.display, fontSize: 30, fontWeight: 700 }}>
                    Table {selected.name}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{look.label.toUpperCase()}</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 500 }}>
                  {selected.checks.length > 1
                    ? `${selected.checks.length} checks · ${selected.checks.reduce((n, c) => n + c.guests, 0)} guests · ${selected.checksTotal}`
                    : check
                      ? `${check.guests} ${check.guests === 1 ? "guest" : "guests"} · ${check.waiterName ? staffBadge(check.waiterName).initials : "no waiter"} · open ${check.minutes} min`
                      : `${selected.seats} seats${area ? ` · ${area.name}` : ""}`}
                </span>
              </div>

              {selected.status === "Available" && (
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>How many guests?</span>
                  <div role="group" aria-label="Guests" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: TOUCH.gap }}>
                    {Array.from({ length: selected.seats > 8 ? Math.min(selected.seats, 12) : 8 }, (_, i) => i + 1).map((n) => (
                      <TouchButton key={n} data-guests={n} background="#2B3139" pressedBackground={TOUCH.teal} disabled={working} onClick={() => open(selected, n)} style={{ height: 60, fontFamily: TOUCH.display, fontSize: 22, fontWeight: 700 }}>
                        {n}
                      </TouchButton>
                    ))}
                  </div>
                  <span style={{ fontSize: 13, color: TOUCH.inkFaint }}>{working ? "Opening…" : "Tapping a number opens the order."}</span>
                </div>
              )}

              {check && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  {selected.checks.length > 1 && (
                    <div role="radiogroup" aria-label="Checks" data-checks style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px", borderBottom: `1px solid ${TOUCH.rule}`, maxHeight: 210, overflowY: "auto" }}>
                      {selected.checks.map((c) => {
                        const on = c.id === check.id;
                        return (
                          <TouchButton
                            key={c.id}
                            role="radio"
                            aria-checked={on}
                            data-check={c.check ?? c.ref}
                            background={on ? LOOK[STAGE_LOOK[c.stage]].bg : TOUCH.strip}
                            color={on ? "#fff" : TOUCH.ink}
                            pressedBackground={on ? undefined : TOUCH.rule}
                            onClick={() => setCheckId(c.id)}
                            style={{ minHeight: 44, padding: "0 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 14, fontWeight: 700 }}
                          >
                            <span>{c.check ?? "Check"} · {LOOK[STAGE_LOOK[c.stage]].label}</span>
                            <span style={{ fontFamily: TOUCH.mono, fontSize: 13 }}>{c.total.replace(/\.00$/, "")}</span>
                          </TouchButton>
                        );
                      })}
                    </div>
                  )}
                  <GuestLinesPanel touch lines={check.pending} busy={working} onConfirm={(ids) => guestDecision(check, ids, true)} onReject={(ids) => guestDecision(check, ids, false)} />
                  <div aria-label="Lines" style={{ flex: 1, overflowY: "auto", padding: "6px 16px" }}>
                    {check.lines.length === 0 && <p style={{ margin: "10px 0", fontSize: 14, color: TOUCH.inkFaint }}>Nothing ordered yet.</p>}
                    {check.lines.map((line) => {
                      const [state, colour] = LINE_STATE[line.kitchenStatus] ?? [line.kitchenStatus, TOUCH.inkDim];
                      return (
                        <div key={line.id} data-panel-line={line.name} style={{ display: "grid", gridTemplateColumns: "30px minmax(0,1fr) auto", gap: 8, padding: "8px 0", borderBottom: `1px solid ${TOUCH.ruleSoft}`, fontSize: 14 }}>
                          <span style={{ fontWeight: 700 }}>{line.quantity}</span>
                          <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{line.name}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: colour }}>{state}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ padding: "10px 16px", borderTop: `1px solid ${TOUCH.rule}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontFamily: TOUCH.display, fontSize: 17, fontWeight: 700 }}>Total</span>
                    <span data-panel-total style={{ fontFamily: TOUCH.display, fontSize: 26, fontWeight: 700 }}>
                      {check.total}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: TOUCH.gap, padding: "0 10px 10px" }}>
                    <TouchButton data-open-order background={TOUCH.send} onClick={() => goToOrder(check.id)} style={{ gridColumn: "span 2", height: 60, fontFamily: TOUCH.display, fontSize: 19, fontWeight: 700 }}>
                      OPEN ORDER
                    </TouchButton>
                    <PrintButton
                      printer={prebill}
                      href={`/restaurant/bill/${check.id}?autoprint=1`}
                      onQueue={() => printBillAction(check.id)}
                      disabled={check.lines.length === 0}
                      ariaLabel="Print bill"
                      style={{ height: 52, border: "none", borderRadius: TOUCH.radius, background: "#2B3139", color: "#fff", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", cursor: "pointer" }}
                    >
                      Print bill
                    </PrintButton>
                    {can.settle ? (
                      <TouchButton data-pay background={TOUCH.pay} pressedBackground={TOUCH.payDown} onClick={() => goToOrder(check.id, true)} style={{ height: 52, fontSize: 15, fontWeight: 700 }}>
                        Pay
                      </TouchButton>
                    ) : (
                      <span />
                    )}
                    <TouchButton data-new-check background="#2B3139" disabled={working} onClick={() => setNaming(true)} style={{ gridColumn: "span 2", height: 48, fontSize: 15, fontWeight: 700 }}>
                      + NEW CHECK · another guest
                    </TouchButton>
                  </div>
                </div>
              )}

              {selected.status === "Reserved" && selected.reservation && (
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>
                    {selected.reservation.time} · {selected.reservation.guestName} · {selected.reservation.partySize} {selected.reservation.partySize === 1 ? "guest" : "guests"}
                  </span>
                  <TouchButton data-seat-guests background={TOUCH.send} disabled={working} onClick={() => seat(selected)} style={{ height: 60, fontFamily: TOUCH.display, fontSize: 18, fontWeight: 700 }}>
                    {working ? "SEATING…" : "SEAT GUESTS"}
                  </TouchButton>
                </div>
              )}

              {selected.status === "Cleaning" && (
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>The last order was billed. Mark the table clean once it&apos;s ready.</span>
                  <TouchButton data-mark-clean background={TOUCH.teal} disabled={working} onClick={() => clean(selected)} style={{ height: 60, fontFamily: TOUCH.display, fontSize: 18, fontWeight: 700 }}>
                    MARK CLEAN
                  </TouchButton>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <FunctionBar left={left} right={right} wide={1.2} />

      {naming && selected && <BarTabDialog busy={working} check={`Table ${selected.name}`} onOpen={(name) => newCheck(selected, name)} onClose={() => setNaming(false)} />}
      {picking && selected && check && (
        <TablePickerModal
          mode={picking}
          from={check.check ? `${selected.name} · ${check.check}` : selected.name}
          orderRef={check.ref}
          options={pickableTables(floor.targets, selected.id, check.warehouseId, picking, check.id)}
          onSubmit={moveOrMerge}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

export default function PosFloor({
  floor,
  counter,
  from,
  can,
  prebill,
  user,
  settings,
  session,
  staff,
  leaveHref,
}: {
  floor: FloorData;
  counter: CounterOrder[];
  from: FromOrder | null;
  can: FloorCan;
  // This till's pre-bill printer (none: the browser's print page).
  prebill: string | null;
  user: { id: string; name: string };
  settings: PosSettings;
  staff: { staff: PosStaff[]; withoutPin: number };
  session: PosSessionInfo;
  leaveHref: string | null;
}) {
  return (
    <PosSession user={user} staff={staff.staff} withoutPin={staff.withoutPin} lockSeconds={session.lockSeconds} terminal={session.terminal} shift={session.shift} training={session.training} leaveHref={leaveHref} lightTheme={settings.lightTheme}>
      <Floor floor={floor} counter={counter} from={from} can={can} prebill={prebill} />
    </PosSession>
  );
}
