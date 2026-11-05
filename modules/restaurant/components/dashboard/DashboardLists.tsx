import Link from "next/link";
import { COLORS, FONTS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { R, STOCK_LEVEL_PILL } from "../../lib/theme";
import type { LowStock, OpenOrders, TopDish } from "../../server/queries/dashboard";
import DashboardCard from "./DashboardCard";

// The dashboard's bottom row: Live open orders, Top dishes and Low-stock
// ingredients (each opens the product's Stock page for its warehouse). null
// means that widget failed to load.

const row = { display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${R.rowBorder}` } as const;
const more = { paddingTop: 10, borderTop: `1px solid ${R.rowBorder}`, fontSize: 12.5, fontWeight: 600 } as const;

export function LiveOpenOrders({ data }: { data: OpenOrders | null }) {
  return (
    <DashboardCard title="Live open orders" failed={!data} empty={data && data.count === 0 ? "No open orders right now." : null}>
      {data?.rows.map((order) => (
        <Link key={order.id} href={`/restaurant/orders/${order.id}`} data-open-order={order.badge} style={{ ...row, color: COLORS.ink }}>
          <span
            style={{ width: 40, height: 32, borderRadius: 7, background: COLORS.tealTint, color: COLORS.tealDark, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONTS.display, fontWeight: 600, fontSize: 13 }}
          >
            {order.badge}
          </span>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>
              {order.waiter} · {order.guests} {order.guests === 1 ? "guest" : "guests"}
            </span>
            <span style={{ fontSize: 12, color: COLORS.slateMid }}>{order.status}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>{order.total}</span>
            <span data-late={order.late || undefined} style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: order.late ? R.danger : COLORS.slateMid }}>
              {order.time}
            </span>
          </div>
        </Link>
      ))}
      {data && data.count > data.rows.length && (
        <Link href="/restaurant/floor" style={more}>
          {data.count - data.rows.length} more on the floor plan
        </Link>
      )}
    </DashboardCard>
  );
}

export function TopDishes({ rows }: { rows: TopDish[] | null }) {
  return (
    <DashboardCard title="Top dishes" failed={!rows} empty={rows && rows.length === 0 ? "No dishes billed in this period yet." : null}>
      {rows?.map((dish, i) => (
        <div key={dish.productId} data-dish-rank={i + 1} style={row}>
          <span style={{ width: 20, fontFamily: FONTS.mono, fontSize: 12, color: COLORS.slateLight }}>{String(i + 1).padStart(2, "0")}</span>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{dish.name}</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.slate }}>{dish.quantity}</span>
          <span style={{ width: 96, textAlign: "right", fontWeight: 600, fontSize: 13.5 }}>{formatNaira(dish.revenue)}</span>
        </div>
      ))}
    </DashboardCard>
  );
}

export function LowStockIngredients({ data, showWarehouse }: { data: LowStock | null; showWarehouse: boolean }) {
  return (
    <DashboardCard title="Low-stock ingredients" failed={!data} empty={data && data.total === 0 ? "No ingredients at or below their alert level." : null}>
      {data?.rows.map((item) => {
        const [bg, fg] = STOCK_LEVEL_PILL[item.level];
        return (
          <Link
            key={`${item.productId}:${item.warehouseId}`}
            href={`/reports/stock/${item.productId}?warehouse=${encodeURIComponent(item.warehouseId)}`}
            data-low-stock={item.name}
            title={`Open ${item.name}'s stock`}
            style={{ ...row, color: COLORS.ink }}
          >
            <span style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{item.name}</span>
              {showWarehouse && <span style={{ fontSize: 12, color: COLORS.slateMid }}>{item.warehouse}</span>}
            </span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 12.5, color: COLORS.slate }}>
              {item.quantity} {item.unit}
            </span>
            <span style={{ height: 22, padding: "0 8px", borderRadius: 11, background: bg, color: fg, fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center" }}>
              {item.level}
            </span>
          </Link>
        );
      })}
      {data && data.total > data.rows.length && (
        <Link href="/products" style={more}>
          {data.total - data.rows.length} more at or below their alert level
        </Link>
      )}
    </DashboardCard>
  );
}
