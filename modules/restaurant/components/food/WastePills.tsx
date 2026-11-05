import type { WasteReason, WasteStatus } from "@prisma/client";
import { WASTE_REASON_LABEL, WASTE_STATUS_LABEL } from "../../lib/waste";
import { WASTE_REASON_PILL, WASTE_STATUS_PILL } from "../../lib/theme";

// Food › Waste pills (the app's pill shape, as ReservationPill).
function Pill({ colors, children, data }: { colors: readonly [string, string]; children: string; data: Record<string, string> }) {
  const [background, color] = colors;
  return (
    <span
      {...data}
      style={{ height: 22, width: "fit-content", padding: "0 9px", borderRadius: 11, background, color, fontSize: 11.5, fontWeight: 600, display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}
    >
      {children}
    </span>
  );
}

export function WasteReasonPill({ reason }: { reason: WasteReason }) {
  return (
    <Pill colors={WASTE_REASON_PILL[reason]} data={{ "data-reason": reason }}>
      {WASTE_REASON_LABEL[reason]}
    </Pill>
  );
}

export function WasteStatusPill({ status }: { status: WasteStatus }) {
  return (
    <Pill colors={WASTE_STATUS_PILL[status]} data={{ "data-status": status }}>
      {WASTE_STATUS_LABEL[status]}
    </Pill>
  );
}
