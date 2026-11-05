import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { ORDER_TYPE_LABEL } from "../../lib/orderLines";
import { ORDER_TYPE_COLOR } from "../../lib/theme";
import type { TypeMixRow } from "../../server/queries/dashboard";
import DashboardCard from "./DashboardCard";

// Order type mix: the stacked bar (share of orders), then each type's order
// count and billed amount.
export default function OrderTypeMix({ rows }: { rows: TypeMixRow[] | null }) {
  const total = rows?.reduce((sum, row) => sum + row.orders, 0) ?? 0;
  return (
    <DashboardCard title="Order type mix" failed={!rows} gap={14}>
      {rows && (
        <>
          <div aria-hidden style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: COLORS.border }}>
            {total > 0 &&
              rows.map((row) =>
                row.orders > 0 ? (
                  <div key={row.type} data-share={row.type} style={{ width: `${(row.orders / total) * 100}%`, background: ORDER_TYPE_COLOR[row.type] }} />
                ) : null,
              )}
          </div>
          {rows.map((row) => (
            <div key={row.type} data-mix={row.type} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: ORDER_TYPE_COLOR[row.type] }} />
              <span style={{ flex: 1 }}>{ORDER_TYPE_LABEL[row.type]}</span>
              <span style={{ fontFamily: FONTS.mono, color: COLORS.slate }}>{row.orders}</span>
              <span style={{ width: 96, textAlign: "right", fontWeight: 600 }}>{formatNaira(row.amount)}</span>
            </div>
          ))}
          {total === 0 && <p style={{ margin: 0, fontSize: 13, color: COLORS.slateMid }}>No orders in this period yet.</p>}
        </>
      )}
    </DashboardCard>
  );
}
