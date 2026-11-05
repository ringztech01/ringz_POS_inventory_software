import Link from "next/link";
import { Banknote, CircleX, ClipboardList, Clock, ConciergeBell, LayoutGrid, ReceiptText, Trash2, Users } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { formatNaira } from "@/lib/format";
import {
  averageBill,
  countDeltaNote,
  floorShare,
  formatPrepTime,
  hourChart,
  moneyDeltaNote,
  percentNote,
  PREP_TARGET_MINUTES,
  resolvePeriod,
  WASTE_LABEL,
  wasteShareNote,
  type WasteLevel,
} from "../lib/dashboard";
import type { KpiTone } from "../lib/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPage } from "../server/guard";
import { loadWidget } from "../server/safely";
import {
  getCancelledLines,
  getFloorNow,
  getLowStockIngredients,
  getOpenOrders,
  getOrderKpis,
  getOrderTypeMix,
  getPrepTime,
  getRestaurantWarehouses,
  getRevenue,
  getSalesByHour,
  getTopDishes,
  getTopWastedItems,
  getWasteKpi,
} from "../server/queries/dashboard";
import HeaderActions from "../components/HeaderActions";
import KpiTile from "../components/dashboard/KpiTile";
import RangeSelect from "../components/dashboard/RangeSelect";
import SalesByHour from "../components/dashboard/SalesByHour";
import OrderTypeMix from "../components/dashboard/OrderTypeMix";
import { LiveOpenOrders, LowStockIngredients, TopDishes, TopWastedItems } from "../components/dashboard/DashboardLists";

// The Waste tile's colour by level (amber / red above the settings' %).
const WASTE_TONE: Record<WasteLevel, KpiTone> = { ok: "green", amber: "amber", red: "rose" };

// /restaurant[?range=today|yesterday|7d] — RingzPOS Restaurant Dashboard:
// eight KPI tiles, Sales by hour, Order type mix, Live open orders, Top
// dishes and Low-stock ingredients; then Waste (the period's, against its
// food cost) and Top wasted items (the last 7 days). Each widget loads on its own (all at
// once), so one that fails shows its error and the rest still render.
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const denied = await guardPage(RESTAURANT_PERMISSIONS.RESTAURANT_DASHBOARD);
  if (denied) return denied;

  const now = new Date();
  const period = resolvePeriod((await searchParams).range, now);
  const [revenue, orders, floor, open, prep, cancelled, hours, mix, dishes, lowStock, warehouses, waste, wasted, current] = await Promise.all([
    loadWidget("revenue", getRevenue(period)),
    loadWidget("orders", getOrderKpis(period)),
    loadWidget("tables occupied", getFloorNow()),
    loadWidget("open orders", getOpenOrders(now)),
    loadWidget("prep time", getPrepTime(period)),
    loadWidget("cancelled lines", getCancelledLines(period)),
    loadWidget("sales by hour", getSalesByHour(period, now)),
    loadWidget("order type mix", getOrderTypeMix(period)),
    loadWidget("top dishes", getTopDishes(period)),
    loadWidget("low stock", getLowStockIngredients()),
    loadWidget("warehouses", getRestaurantWarehouses()),
    loadWidget("waste", getWasteKpi(period)),
    loadWidget("top wasted items", getTopWastedItems(now)),
    getCurrentUserPermissions(),
  ]);
  const canOpenWaste = current.permissions.has(RESTAURANT_PERMISSIONS.LOG_WASTE) || current.permissions.has(RESTAURANT_PERMISSIONS.APPROVE_WASTE);
  const vsName = period.previousName;
  const place = warehouses.ok && warehouses.data.length ? `${warehouses.data.join(", ")} · ` : "";

  const r = revenue.ok ? revenue.data : null;
  const o = orders.ok ? orders.data : null;
  const avgNow = r ? averageBill(r.current.revenue, r.current.bills) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <HeaderActions>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RangeSelect value={period.key} />
          <Link
            href="/restaurant/floor"
            style={{ height: 36, padding: "0 14px", display: "flex", alignItems: "center", background: COLORS.teal, borderRadius: 8, color: "#fff", fontSize: 13.5, fontWeight: 600 }}
          >
            Open floor
          </Link>
        </div>
      </HeaderActions>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>Restaurant overview</h1>
        <span style={{ fontSize: 13, color: COLORS.slateMid }}>
          {place}
          {period.dayText}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14 }}>
        <KpiTile
          label={period.revenueLabel}
          tone="teal"
          icon={Banknote}
          value={r ? formatNaira(r.current.revenue) : null}
          note={r ? percentNote(r.current.revenue, r.previous.revenue, vsName) : ""}
        />
        <KpiTile label="Orders" tone="blue" icon={ClipboardList} value={o ? String(o.current.orders) : null} note={o ? countDeltaNote(o.current.orders, o.previous.orders, vsName) : ""} />
        <KpiTile
          label="Average bill"
          tone="violet"
          icon={ReceiptText}
          value={r && avgNow ? formatNaira(avgNow) : null}
          note={r && avgNow ? moneyDeltaNote(avgNow, averageBill(r.previous.revenue, r.previous.bills), vsName) : ""}
        />
        <KpiTile label="Covers" tone="amber" icon={Users} value={o ? String(o.current.covers) : null} note={o ? countDeltaNote(o.current.covers, o.previous.covers, vsName) : ""} />
        <KpiTile
          label="Tables occupied"
          tone="cyan"
          icon={LayoutGrid}
          value={floor.ok ? `${floor.data.occupied} / ${floor.data.total}` : null}
          note={floor.ok ? floorShare(floor.data.occupied, floor.data.total) : ""}
        />
        <KpiTile
          label="Open orders"
          tone="orange"
          icon={ConciergeBell}
          value={open.ok ? String(open.data.count) : null}
          note={open.ok ? `${open.data.waitingForBill} waiting for bill` : ""}
        />
        <KpiTile label="Avg prep time" tone="green" icon={Clock} value={prep.ok ? formatPrepTime(prep.data.current) : null} note={`Target ${PREP_TARGET_MINUTES}m`} />
        <KpiTile
          label="Cancelled lines"
          tone="rose"
          icon={CircleX}
          value={cancelled.ok ? String(cancelled.data.current.count) : null}
          note={
            cancelled.ok
              ? `${formatNaira(cancelled.data.current.value)} voided · ${countDeltaNote(cancelled.data.current.count, cancelled.data.previous.count, vsName)}`
              : ""
          }
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 14 }}>
        <SalesByHour chart={hours.ok ? hourChart(hours.data) : null} />
        <OrderTypeMix rows={mix.ok ? mix.data : null} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 14 }}>
        <LiveOpenOrders data={open.ok ? open.data : null} />
        <TopDishes rows={dishes.ok ? dishes.data : null} />
        <LowStockIngredients data={lowStock.ok ? lowStock.data : null} showWarehouse={warehouses.ok && warehouses.data.length > 1} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,3fr)", gap: 14, alignItems: "start" }}>
        <KpiTile
          label={WASTE_LABEL[period.key]}
          tone={waste.ok ? WASTE_TONE[waste.data.level] : "green"}
          icon={Trash2}
          value={waste.ok ? formatNaira(waste.data.cost) : null}
          note={waste.ok ? wasteShareNote(waste.data.share, waste.data.foodCost, waste.data.entries) : ""}
        />
        <TopWastedItems data={wasted.ok ? wasted.data : null} canOpen={canOpenWaste} />
      </div>
    </div>
  );
}
