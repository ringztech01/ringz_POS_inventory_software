"use client";

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import ConfirmDeleteModal from "@/components/ui/ConfirmDeleteModal";
import { addDays } from "@/lib/dateRanges";
import { R } from "../../lib/theme";
import { dayLabel } from "../../lib/time";
import { cancelReservation, markReservationNoShow, seatReservation } from "../../server/actions/reservations";
import type { BookingCustomer, BookingTable, ReservationRow } from "../../server/queries/reservations";
import BookingModal from "./BookingModal";
import ReservationDetailsModal from "./ReservationDetailsModal";
import ReservationMenu from "./ReservationMenu";
import { ReservationPill } from "./ReservationPill";

type Pending = { kind: "seat" | "cancel" | "noShow"; row: ReservationRow };

function RowButton({ children, onClick, primary }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        height: 30,
        padding: "0 10px",
        border: `1px solid ${primary ? COLORS.teal : COLORS.borderStrong}`,
        background: hover.value ? (primary ? COLORS.tealTint : COLORS.bgApp) : "#fff",
        borderRadius: 7,
        fontSize: 12.5,
        fontWeight: 600,
        color: primary ? COLORS.tealDark : COLORS.slate,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function DayButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  const hover = useToggleState();
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={hover.on}
      onMouseLeave={hover.off}
      style={{
        width: 24,
        height: 24,
        border: "none",
        borderRadius: 6,
        background: hover.value ? COLORS.bgApp : "transparent",
        color: COLORS.slateMid,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

const CONFIRM: Record<Pending["kind"], (row: ReservationRow) => { title: string; message: string; confirm: string; pending: string; tone: "danger" | "primary" }> = {
  seat: (row) => ({
    title: `Seat ${row.guestName}?`,
    message: `This opens an order on ${row.tableName} for ${row.partySize} ${row.partySize === 1 ? "guest" : "guests"} and marks the booking as seated.`,
    confirm: "Seat",
    pending: "Seating…",
    tone: "primary",
  }),
  cancel: (row) => ({
    title: "Cancel booking",
    message: `Cancel ${row.guestName}'s booking at ${row.time} on ${row.tableName}?`,
    confirm: "Cancel booking",
    pending: "Cancelling…",
    tone: "danger",
  }),
  noShow: (row) => ({
    title: "Mark as no-show",
    message: `${row.guestName} (${row.time}, ${row.tableName}) didn't come? The booking is closed as a no-show.`,
    confirm: "Mark no-show",
    pending: "Saving…",
    tone: "danger",
  }),
};

// RingzPOS Tables design, Reservations panel: one day's bookings (?date=,
// default today) with time, guest · party, phone · table, status pill and
// the action — Seat (plus Cancel / Mark no-show) while Booked, View after.
// Booked parties more than 30 minutes late are flagged in red.
export default function ReservationsPanel({
  rows,
  day,
  today,
  gapLabel,
  tables,
  customers,
}: {
  rows: ReservationRow[];
  day: string;
  today: string;
  // The double-booking window, e.g. "2 hours".
  gapLabel: string;
  tables: BookingTable[];
  customers: BookingCustomer[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [booking, setBooking] = useState(false);
  const [viewing, setViewing] = useState<ReservationRow | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [isWorking, startWork] = useTransition();
  const label = dayLabel(day, today);

  function goToDay(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === today) params.delete("date");
    else params.set("date", next);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function confirm() {
    if (!pending) return;
    const { kind, row } = pending;
    startWork(async () => {
      const result =
        kind === "seat" ? await seatReservation(row.id)
        : kind === "cancel" ? await cancelReservation(row.id)
        : await markReservationNoShow(row.id);
      setPending(null);
      if (result.ok) {
        toast.success(
          "orderRef" in result ? `${row.guestName} seated at ${row.tableName}. Order ${result.orderRef} is open.`
          : kind === "cancel" ? `${row.guestName}'s booking cancelled.`
          : `${row.guestName} marked as a no-show.`,
        );
      } else {
        toast.error(result.error);
        router.refresh();
      }
    });
  }

  const dialog = pending ? CONFIRM[pending.kind](pending.row) : null;

  return (
    <section
      aria-label="Reservations"
      style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 19, fontWeight: 600 }}>Reservations</h2>
        <span style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <DayButton title="Previous day" onClick={() => goToDay(addDays(day, -1))}>
            <ChevronLeft size={14} strokeWidth={1.8} />
          </DayButton>
          <button
            type="button"
            title={day === today ? undefined : "Back to today"}
            onClick={() => goToDay(today)}
            aria-label="Day"
            style={{ border: "none", background: "none", padding: "0 2px", fontSize: 12.5, color: COLORS.slateMid, cursor: day === today ? "default" : "pointer", minWidth: 64 }}
          >
            {label}
          </button>
          <DayButton title="Next day" onClick={() => goToDay(addDays(day, 1))}>
            <ChevronRight size={14} strokeWidth={1.8} />
          </DayButton>
        </span>
        <button
          type="button"
          onClick={() => setBooking(true)}
          disabled={tables.length === 0}
          title={tables.length === 0 ? "Add tables first." : undefined}
          style={{
            marginLeft: "auto",
            height: 32,
            padding: "0 10px",
            background: tables.length === 0 ? COLORS.slateLight : COLORS.teal,
            border: "none",
            borderRadius: 7,
            fontSize: 12.5,
            fontWeight: 600,
            color: "#fff",
            cursor: tables.length === 0 ? "not-allowed" : "pointer",
          }}
        >
          + New booking
        </button>
      </div>

      {rows.length === 0 ? (
        <p style={{ margin: 0, padding: "10px 0", borderTop: `1px solid ${R.rowBorder}`, fontSize: 13.5, color: COLORS.slateMid }}>
          No bookings for {label === "Today" || label === "Tomorrow" || label === "Yesterday" ? label.toLowerCase() : label}.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            data-booking={row.guestName}
            data-late={row.late || undefined}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${R.rowBorder}` }}
          >
            <span
              title={row.late ? "More than 30 minutes late — seat them or mark a no-show." : undefined}
              style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 600, width: 44, color: row.late ? R.danger : COLORS.ink }}
            >
              {row.time}
            </span>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {row.guestName} · {row.partySize} {row.partySize === 1 ? "guest" : "guests"}
              </span>
              <span style={{ fontSize: 12, color: COLORS.slateMid }}>
                {row.guestPhone} · {row.tableName}
                {row.late && <span style={{ color: R.danger, fontWeight: 600 }}> · Late</span>}
              </span>
            </div>
            <ReservationPill status={row.status} />
            {row.status === "BOOKED" ? (
              <span style={{ display: "flex", gap: 6 }}>
                <RowButton primary onClick={() => setPending({ kind: "seat", row })}>
                  Seat
                </RowButton>
                <ReservationMenu onCancel={() => setPending({ kind: "cancel", row })} onNoShow={() => setPending({ kind: "noShow", row })} />
              </span>
            ) : (
              <RowButton onClick={() => setViewing(row)}>View</RowButton>
            )}
          </div>
        ))
      )}
      <span style={{ fontSize: 12, color: COLORS.slateMid }}>A table can&apos;t be double-booked within {gapLabel}.</span>

      {booking && (
        <BookingModal
          tables={tables}
          customers={customers}
          defaultDay={day}
          today={today}
          onBooked={(bookedDay) => bookedDay !== day && goToDay(bookedDay)}
          onClose={() => setBooking(false)}
        />
      )}
      {viewing && <ReservationDetailsModal row={viewing} dayText={label} onClose={() => setViewing(null)} />}
      {pending && dialog && (
        <ConfirmDeleteModal
          title={dialog.title}
          message={dialog.message}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
          pending={isWorking}
          confirmLabel={dialog.confirm}
          pendingLabel={dialog.pending}
          tone={dialog.tone}
        />
      )}
    </section>
  );
}
