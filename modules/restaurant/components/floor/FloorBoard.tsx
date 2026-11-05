"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { FLOOR_CARD, FLOOR_SELECTED, R, TABLE_STATUS_PILL } from "../../lib/theme";
import { markTableClean, mergeOrderInto, moveOrderToTable, openTable } from "../../server/actions/floor";
import { seatReservation } from "../../server/actions/reservations";
import type { FloorTable, FloorTarget } from "../../server/queries/floor";
import { pickableTables, type MoveMode } from "../../lib/tableMoves";
import TablePickerModal from "./TablePickerModal";


function TableCard({ table, selected, onSelect }: { table: FloorTable; selected: boolean; onSelect: () => void }) {
  const look = FLOOR_CARD[table.status];
  const detail =
    table.order ? `${table.order.waiter ?? "—"} · ${table.order.guests} ${table.order.guests === 1 ? "guest" : "guests"}`
    : table.status === "Reserved" && table.reservation ? `${table.reservation.guestName} · ${table.reservation.partySize}`
    : "";
  const meta =
    table.order ? `${table.order.total} · ${table.order.open}`
    : table.status === "Reserved" && table.reservation ? table.reservation.time
    : "";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-floor-table={table.name}
      data-status={table.status}
      style={{
        height: 132,
        border: selected ? FLOOR_SELECTED.border : look.border,
        borderRadius: 14,
        background: look.background,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 4,
        cursor: "pointer",
        textAlign: "left",
        boxShadow: selected ? FLOOR_SELECTED.boxShadow : "none",
        color: look.color,
      }}
    >
      <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 600 }}>{table.name}</span>
          {!!table.order?.ready && (
            <span
              data-ready={table.order.ready}
              role="img"
              aria-label={`${table.order.ready} ready to serve`}
              title={`${table.order.ready} ready to serve`}
              style={{ width: 10, height: 10, borderRadius: 5, background: COLORS.teal, boxShadow: "0 0 0 2px #fff" }}
            />
          )}
        </span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 11.5 }}>{table.seats} seats</span>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>{table.status}</span>
      <span style={{ marginTop: "auto", fontSize: 13 }}>{detail}</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 12 }}>{meta}</span>
    </button>
  );
}

function PanelButton({
  children,
  onClick,
  disabledReason,
  primary,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabledReason?: string | null;
  primary?: boolean;
}) {
  const hover = useToggleState();
  const disabled = !!disabledReason;
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabledReason ?? undefined}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={
        primary
          ? {
              height: 42,
              background: disabled ? COLORS.slateLight : hover.value ? COLORS.tealDark : COLORS.teal,
              border: "none",
              borderRadius: 9,
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              cursor: disabled ? "not-allowed" : "pointer",
            }
          : {
              height: 38,
              background: hover.value && !disabled ? COLORS.bgApp : "#fff",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.slate,
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.55 : 1,
            }
      }
    >
      {children}
    </button>
  );
}

const fact = { background: COLORS.bgApp, borderRadius: 9, padding: "10px 12px" } as const;

// The floor plan's live part (RingzPOS Floor Plan design): the selected
// area's table cards (`header` — area tabs and legend — comes from the
// server) and the side panel for the selected card. Everything shown is
// worked out on the server; this only picks a card and runs the actions.
export default function FloorBoard({
  header,
  tables,
  targets,
  emptyMessage,
  canOrders,
  canBook,
}: {
  header: ReactNode;
  tables: FloorTable[];
  targets: FloorTarget[];
  emptyMessage: string;
  canOrders: boolean;
  canBook: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmSeat, setConfirmSeat] = useState(false);
  const [picking, setPicking] = useState<MoveMode | null>(null);
  const [isWorking, startWork] = useTransition();
  // A table that left the area (or was deleted) falls back to the first.
  const selected = tables.find((t) => t.id === selectedId) ?? tables[0] ?? null;

  const needsOrders = canOrders ? null : "Needs the Manage Orders permission.";
  const needsBookings = canBook ? null : "Needs the Manage Reservations permission.";

  function goToOrder(orderId: string) {
    router.push(`/restaurant/orders/${orderId}`);
  }

  function primary() {
    if (!selected || isWorking) return;
    if (selected.status === "Occupied" && selected.order) return goToOrder(selected.order.id);
    if (selected.status === "Reserved") return setConfirmSeat(true);
    startWork(async () => {
      if (selected.status === "Cleaning") {
        const result = await markTableClean(selected.id);
        if (result.ok) {
          toast.success(`${selected.name} is clean and free.`);
        } else {
          toast.error(result.error);
          router.refresh();
        }
        return;
      }
      const result = await openTable(selected.id);
      if (result.ok) return goToOrder(result.orderId);
      toast.error(result.error);
      if (result.orderId) goToOrder(result.orderId);
      else router.refresh();
    });
  }

  function seat() {
    const booking = selected?.reservation;
    if (!booking) return;
    startWork(async () => {
      const result = await seatReservation(booking.id);
      setConfirmSeat(false);
      if (result.ok) {
        toast.success(`${booking.guestName} seated. Order ${result.orderRef} is open.`);
        goToOrder(result.orderId);
      } else {
        toast.error(result.error);
        router.refresh();
      }
    });
  }

  // Move / Merge: the selected table's order to a free table, or into
  // another occupied table's order — in the same warehouse.
  const order = selected?.order ?? null;
  const moveBlocked = !order ? "Only an occupied table's order can move." : needsOrders;

  async function moveOrMerge(target: FloorTarget): Promise<boolean> {
    if (!order || !selected || !picking) return false;
    const result =
      picking === "move"
        ? await moveOrderToTable({ orderId: order.id, version: order.version, tableId: target.id })
        : await mergeOrderInto({ orderId: order.id, version: order.version, targetOrderId: target.orderId });
    if (result.ok) {
      toast.success(
        "targetRef" in result ? `${selected.name} merged into ${result.targetRef} at ${target.name}.` : `${order.ref} moved to ${target.name}.`,
      );
      return true;
    }
    toast.error(result.error);
    if (result.stale) router.refresh();
    return false;
  }

  const action =
    selected?.status === "Occupied" ? { label: "Open order", blocked: needsOrders }
    : selected?.status === "Reserved" ? { label: "Seat reservation", blocked: needsBookings }
    : selected?.status === "Cleaning" ? { label: "Mark clean", blocked: needsOrders }
    : { label: "Open table", blocked: needsOrders };

  const [pillBg, pillFg] = selected ? TABLE_STATUS_PILL[selected.status] : ["", ""];

  return (
    <>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        {header}
        {tables.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>{emptyMessage}</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {tables.map((table) => (
              <TableCard key={table.id} table={table} selected={table.id === selected?.id} onSelect={() => setSelectedId(table.id)} />
            ))}
          </div>
        )}
      </div>

      <aside
        aria-label="Table details"
        style={{ background: "#fff", borderLeft: `1px solid ${COLORS.border}`, padding: 22, display: "flex", flexDirection: "column", gap: 16 }}
      >
        {!selected ? (
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>Pick a table to see its details.</p>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 20, fontWeight: 600 }}>Table {selected.name}</h2>
              <span style={{ height: 24, padding: "0 10px", borderRadius: 12, background: pillBg, color: pillFg, fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center" }}>
                {selected.status}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={fact}>
                <div style={{ fontSize: 11.5, color: COLORS.slateMid }}>Seats</div>
                <div style={{ fontWeight: 600 }}>{selected.seats}</div>
              </div>
              <div style={fact}>
                <div style={{ fontSize: 11.5, color: COLORS.slateMid }}>Waiter</div>
                <div style={{ fontWeight: 600 }}>{selected.order?.waiter ?? "—"}</div>
              </div>
            </div>

            {selected.order ? (
              <div aria-label="Current order" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: COLORS.slateMid }}>
                  Current order · {selected.order.ref}
                </span>
                {selected.order.lines.length === 0 && <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>Nothing ordered yet.</span>}
                {selected.order.lines.map((line) => (
                  <div key={line.id} style={{ display: "flex", gap: 10, fontSize: 13.5, padding: "6px 0", borderBottom: `1px solid ${R.rowBorder}` }}>
                    <span style={{ fontFamily: FONTS.mono, color: COLORS.slateMid }}>{line.quantity}×</span>
                    <span style={{ flex: 1 }}>{line.name}</span>
                    <span style={{ fontWeight: 500 }}>{line.amount}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, fontSize: 15, paddingTop: 4 }}>
                  <span>Total</span>
                  <span>{selected.order.total}</span>
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
                {selected.status === "Reserved" && selected.reservation
                  ? `Reserved for ${selected.reservation.guestName} · ${selected.reservation.partySize} at ${selected.reservation.time}. Seat them to open their order.`
                  : selected.status === "Cleaning"
                    ? "The last order was billed. Mark the table clean once it's ready."
                    : "No open order. Open the table to start taking an order."}
              </p>
            )}

            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              <PanelButton primary onClick={primary} disabledReason={action.blocked ?? (isWorking ? "Working…" : null)}>
                {isWorking && !confirmSeat ? "Working…" : action.label}
              </PanelButton>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <PanelButton onClick={() => setPicking("move")} disabledReason={moveBlocked}>
                  Move table
                </PanelButton>
                <PanelButton onClick={() => setPicking("merge")} disabledReason={moveBlocked}>
                  Merge
                </PanelButton>
              </div>
            </div>
          </>
        )}
      </aside>

      {picking && order && selected && (
        <TablePickerModal
          mode={picking}
          from={selected.name}
          orderRef={order.ref}
          options={pickableTables(targets, selected.id, order.warehouseId, picking)}
          onSubmit={moveOrMerge}
          onClose={() => setPicking(null)}
        />
      )}
      {confirmSeat && selected?.reservation && (
        <ConfirmDeleteModal
          title={`Seat ${selected.reservation.guestName}?`}
          message={`This opens an order on ${selected.name} for ${selected.reservation.partySize} ${selected.reservation.partySize === 1 ? "guest" : "guests"} and marks the booking as seated.`}
          onCancel={() => setConfirmSeat(false)}
          onConfirm={seat}
          pending={isWorking}
          confirmLabel="Seat"
          pendingLabel="Seating…"
          tone="primary"
        />
      )}
    </>
  );
}
