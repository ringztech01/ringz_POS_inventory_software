import { ClipboardList } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import EmptyState from "@/components/ui/EmptyState";
import AdjustmentRowMenu from "./AdjustmentRowMenu";
import { formatDateTime } from "@/lib/format";
import type { AdjustmentListRow } from "@/app/(dashboard)/adjustments/queries";

const GRID_COLUMNS = "40px minmax(160px,1fr) minmax(160px,1fr) 140px 100px 150px 40px";
const HEADERS = ["Reference", "Warehouse", "Date", "Items", "Created on", "Action"];

function Checkbox() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        border: "1.5px solid #c3cacc",
        background: "#fff",
      }}
    />
  );
}

export default function AdjustmentTable({ adjustments }: { adjustments: AdjustmentListRow[] }) {
  if (adjustments.length === 0) {
    return <EmptyState icon={ClipboardList} message="No adjustments found." />;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 900 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLUMNS,
            columnGap: 16,
            alignItems: "center",
            padding: "0 20px",
            height: 44,
            background: COLORS.bgInput,
            borderBottom: `1px solid ${COLORS.border}`,
            whiteSpace: "nowrap",
          }}
        >
          <Checkbox />
          {HEADERS.map((label) => (
            <span
              key={label}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: COLORS.slateMid,
                textAlign: label === "Items" || label === "Action" ? "right" : "left",
              }}
            >
              {label}
            </span>
          ))}
        </div>

        {adjustments.map((adjustment) => {
          const createdOn = formatDateTime(adjustment.createdAt);
          const { date: adjustmentDate } = formatDateTime(adjustment.date);

          return (
            <div
              key={adjustment.id}
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLUMNS,
                columnGap: 16,
                alignItems: "center",
                padding: "0 20px",
                height: 68,
                borderBottom: `1px solid ${COLORS.bgApp}`,
                whiteSpace: "nowrap",
                position: "relative",
              }}
            >
              <Checkbox />
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 12,
                  fontWeight: 500,
                  background: COLORS.bgApp,
                  border: `1px solid ${COLORS.borderStrong}`,
                  color: COLORS.text,
                  padding: "4px 9px",
                  borderRadius: 6,
                  justifySelf: "start",
                }}
              >
                {adjustment.reference}
              </span>
              <span style={{ fontSize: 14, color: COLORS.text }}>{adjustment.warehouse.name}</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.slate }}>{adjustmentDate}</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 600, textAlign: "right" }}>
                {adjustment._count.items}
              </span>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.text }}>{createdOn.date}</span>
                <span style={{ fontSize: 11.5, color: COLORS.slateLight }}>{createdOn.time}</span>
              </span>
              <AdjustmentRowMenu id={adjustment.id} reference={adjustment.reference} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
