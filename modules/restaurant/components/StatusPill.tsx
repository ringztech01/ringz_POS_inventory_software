import type { TableStatus } from "../lib/tableStatus";
import { TABLE_STATUS_PILL } from "../lib/theme";

// A table's status pill (Tables and Floor Plan designs). The status itself
// always comes from lib/tableStatus.ts.
export default function StatusPill({ status }: { status: TableStatus }) {
  const [background, color] = TABLE_STATUS_PILL[status];
  return (
    <span
      style={{
        height: 22,
        width: "fit-content",
        padding: "0 9px",
        borderRadius: 11,
        background,
        color,
        fontSize: 11.5,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {status}
    </span>
  );
}
