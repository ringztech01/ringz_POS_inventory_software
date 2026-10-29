import type { ReactNode } from "react";
import { FileBarChart } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import HoverRow from "@/components/dashboard/HoverRow";

export type ReportColumn<T> = {
  label: string;
  // A grid track, e.g. "130px" or "minmax(160px,1fr)".
  width: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
};

const header = {
  fontSize: 11.5,
  fontWeight: 600,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: COLORS.slateMid,
} as const;

// The report table (RingzPOS Reports design): 48px header between borders,
// 52px rows with a hover tint, horizontal scroll past `minWidth`. Cells are
// rendered on the server from the column definitions. `flush`: the table is
// the card's first child, so the header has no top border (Sale / Purchase /
// Stock Reports, whose 56px rows use `rowHeight`).
export default function ReportTable<T>({
  columns,
  rows,
  rowKey,
  minWidth,
  emptyMessage,
  rowHeight = 52,
  flush = false,
}: {
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  minWidth: number;
  emptyMessage: string;
  rowHeight?: number;
  flush?: boolean;
}) {
  const grid = columns.map((column) => column.width).join(" ");

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: grid,
            columnGap: 16,
            alignItems: "center",
            padding: "0 20px",
            height: 48,
            background: COLORS.bgInput,
            borderTop: flush ? "none" : `1px solid ${COLORS.border}`,
            borderBottom: `1px solid ${COLORS.border}`,
            whiteSpace: "nowrap",
          }}
        >
          {columns.map((column) => (
            <span key={column.label} style={{ ...header, textAlign: column.align ?? "left" }}>
              {column.label}
            </span>
          ))}
        </div>

        {rows.length === 0 ? (
          <div style={{ padding: "44px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                background: COLORS.bgApp,
                color: COLORS.slateLight,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FileBarChart size={19} strokeWidth={1.6} />
            </span>
            <span style={{ fontSize: 13.5, color: COLORS.slateMid }}>{emptyMessage}</span>
          </div>
        ) : (
          rows.map((row) => (
            <HoverRow
              key={rowKey(row)}
              style={{
                display: "grid",
                gridTemplateColumns: grid,
                columnGap: 16,
                alignItems: "center",
                padding: "0 20px",
                height: rowHeight,
                borderBottom: "1px solid #f5f7f7",
                whiteSpace: "nowrap",
              }}
            >
              {columns.map((column) => (
                <span
                  key={column.label}
                  style={{ textAlign: column.align ?? "left", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {column.render(row)}
                </span>
              ))}
            </HoverRow>
          ))
        )}
      </div>
    </div>
  );
}

// ---- cells shared by the reports (the design's styles)

// The design's reference pill.
export function ReferenceCell({ value }: { value: string }) {
  return (
    <span
      style={{
        fontFamily: FONTS.mono,
        fontSize: 12,
        fontWeight: 500,
        background: "#fce8e6",
        border: "1px solid #f4cfcc",
        color: "#93201a",
        padding: "4px 9px",
        borderRadius: 6,
      }}
    >
      {value}
    </span>
  );
}

export function MoneyCell({ value, strong }: { value: string; strong?: boolean }) {
  return (
    <span
      style={{
        fontFamily: FONTS.mono,
        fontSize: 13,
        fontWeight: strong ? 600 : 400,
        color: strong ? COLORS.ink : COLORS.slate,
      }}
    >
      {value}
    </span>
  );
}

export function TextCell({ value, muted }: { value: string; muted?: boolean }) {
  return <span style={{ fontSize: 14, color: muted ? COLORS.slate : COLORS.text }}>{value}</span>;
}
