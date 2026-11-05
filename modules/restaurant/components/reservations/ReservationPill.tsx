import type { ReservationStatus } from "@prisma/client";
import { RESERVATION_STATUS_LABEL } from "../../lib/reservations";
import { RESERVATION_PILL } from "../../lib/theme";

// A booking's status pill (Tables design).
export function ReservationPill({ status }: { status: ReservationStatus }) {
  const [background, color] = RESERVATION_PILL[status];
  return (
    <span
      style={{
        height: 22,
        padding: "0 9px",
        borderRadius: 11,
        background,
        color,
        fontSize: 11.5,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
      }}
    >
      {RESERVATION_STATUS_LABEL[status]}
    </span>
  );
}
