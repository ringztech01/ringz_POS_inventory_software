"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { RESERVATION_STATUS_LABEL } from "../../lib/reservations";
import type { ReservationRow } from "../../server/queries/reservations";
import { ReservationPill } from "./ReservationPill";

// "View" on a booking that's no longer Booked: its details, read-only, and
// the order it opened when seated.
export default function ReservationDetailsModal({ row, dayText, onClose }: { row: ReservationRow; dayText: string; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const facts: [string, string][] = [
    ["When", `${dayText} · ${row.time}`],
    ["Guest", row.customerName ? `${row.guestName} (customer)` : row.guestName],
    ["Phone", row.guestPhone],
    ["Party", `${row.partySize} ${row.partySize === 1 ? "guest" : "guests"}`],
    ["Table", `${row.tableName} · ${row.areaName}`],
    ["Status", RESERVATION_STATUS_LABEL[row.status]],
  ];

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(7,27,24,.44)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80, animation: "elv-fade .12s ease-out" }}
    >
      <div
        role="dialog"
        aria-label="Booking details"
        onClick={(event) => event.stopPropagation()}
        style={{ width: 420, background: "#fff", borderRadius: 12, boxShadow: "0 20px 48px -12px rgba(23,27,28,.34)", overflow: "hidden", animation: "elv-pop .16s ease-out" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 24px", borderBottom: `1px solid ${COLORS.border}` }}>
          <h4 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 18, fontWeight: 600 }}>Booking</h4>
          <ReservationPill status={row.status} />
          <button
            type="button"
            title="Close"
            onClick={onClose}
            style={{ marginLeft: "auto", width: 30, height: 30, border: "none", background: "transparent", borderRadius: 6, cursor: "pointer", color: COLORS.slateMid, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>
        <dl style={{ margin: 0, padding: "18px 24px", display: "grid", gridTemplateColumns: "90px 1fr", rowGap: 10, fontSize: 13.5 }}>
          {facts.map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt style={{ color: COLORS.slateMid }}>{label}</dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>{value}</dd>
            </div>
          ))}
          {row.orderId && row.orderRef && (
            <div style={{ display: "contents" }}>
              <dt style={{ color: COLORS.slateMid }}>Order</dt>
              <dd style={{ margin: 0 }}>
                <Link href={`/restaurant/orders/${row.orderId}`} style={{ fontFamily: FONTS.mono, fontWeight: 600, color: COLORS.teal, textDecoration: "none" }}>
                  {row.orderRef}
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
