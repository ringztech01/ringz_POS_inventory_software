import type { LucideIcon } from "lucide-react";
import {
  ShoppingCart,
  PackagePlus,
  ArrowRight,
  ArrowLeft,
  CircleDollarSign,
  Banknote,
  ShoppingBasket,
  MinusCircle,
} from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import {
  getDashboardKpis,
  getRecentSales,
  getStockAlerts,
  getTopCustomers,
  getTopSellingProductsThisMonth,
  getTopSellingProductsThisYear,
  getWeeklySalesPurchases,
  type DashboardKpis,
} from "@/lib/dashboard/queries";
import { monthName, yearOf } from "@/lib/dateRanges";
import { formatNaira } from "@/lib/format";
import SalesPurchasesChart from "@/components/dashboard/SalesPurchasesChart";
import DonutCard, { DONUT_COLORS } from "@/components/dashboard/DonutCard";
import TopSellingMayCard from "@/components/dashboard/TopSellingMayCard";
import RecentSalesCard from "@/components/dashboard/RecentSalesCard";
import StockAlertCard from "@/components/dashboard/StockAlertCard";

// Tile definitions (lib/dashboard/queries.ts → getDashboardKpis):
//   Sales / Purchases ........ Σ grandTotal of Received sales / purchases
//   Sales Returns ............ Σ grandTotal of Received or Completed returns
//   Purchases Returns ........ Σ grandTotal of Received purchase returns
//   Today total sales ........ Σ grandTotal of Received sales dated today
//   Today total received ..... Σ SalePayment.amount dated today (cash in)
//   Today total purchases .... Σ grandTotal of Received purchases dated today
//   Today total expense ...... Σ Expense.amount dated today
// "Today" is the Africa/Lagos calendar day (lib/dateRanges.ts).

type PrimaryStat = {
  kpi: keyof DashboardKpis;
  Icon: LucideIcon;
  label: string;
  bg: string;
  iconBg: string;
  labelOpacity: number;
};

const PRIMARY_STATS: PrimaryStat[] = [
  { kpi: "sales", Icon: ShoppingCart, label: "Sales", bg: "#0f7d6a", iconBg: "rgba(255,255,255,.18)", labelOpacity: 0.88 },
  { kpi: "purchases", Icon: PackagePlus, label: "Purchases", bg: "#073b33", iconBg: "rgba(255,255,255,.16)", labelOpacity: 0.85 },
  { kpi: "saleReturns", Icon: ArrowRight, label: "Sales Returns", bg: "#1c62a8", iconBg: "rgba(255,255,255,.20)", labelOpacity: 0.88 },
  { kpi: "purchaseReturns", Icon: ArrowLeft, label: "Purchases Returns", bg: "#a76a09", iconBg: "rgba(255,255,255,.20)", labelOpacity: 0.9 },
];

type SecondaryStat = {
  kpi: keyof DashboardKpis;
  Icon: LucideIcon;
  label: string;
  iconBg: string;
  iconColor: string;
  valueColor?: string;
};

const SECONDARY_STATS: SecondaryStat[] = [
  { kpi: "todaySales", Icon: CircleDollarSign, label: "Today total sales", iconBg: "#eff8f6", iconColor: COLORS.teal },
  { kpi: "todayReceived", Icon: Banknote, label: "Today total received (sales)", iconBg: "#e2f4ec", iconColor: "#10805c" },
  { kpi: "todayPurchases", Icon: ShoppingBasket, label: "Today total purchases", iconBg: "#e3eefb", iconColor: "#1c62a8" },
  { kpi: "todayExpenses", Icon: MinusCircle, label: "Today total expense", iconBg: "#fce8e6", iconColor: COLORS.danger, valueColor: COLORS.danger },
];

// Stock Alert: the 10 lowest rows, or (?stock=all) every row up to a cap.
const STOCK_ALERT_PREVIEW = 10;
const STOCK_ALERT_ALL = 500;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ stock?: string }> }) {
  const denied = await pageGuard(PERMISSIONS.MANAGE_DASHBOARD);
  if (denied) return denied;

  // Read-only aggregates, computed in the DB (empty sums → ₦0.00), fetched
  // in parallel.
  // One `now` for every section, so they all agree on today/month/year.
  const now = new Date();
  const showAllStockAlerts = (await searchParams).stock === "all";
  const [kpis, week, topYear, topMonth, topCustomers, recentSales, stockAlerts] = await Promise.all([
    getDashboardKpis(now),
    getWeeklySalesPurchases(now),
    getTopSellingProductsThisYear(now),
    getTopSellingProductsThisMonth(now),
    getTopCustomers(now),
    getRecentSales(),
    getStockAlerts(showAllStockAlerts ? STOCK_ALERT_ALL : STOCK_ALERT_PREVIEW),
  ]);
  const month = monthName(now);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 20 }}>
        {PRIMARY_STATS.map(({ kpi, Icon, label, bg, iconBg, labelOpacity }) => (
          <div
            key={label}
            style={{
              background: bg,
              borderRadius: 16,
              padding: 22,
              display: "flex",
              alignItems: "center",
              gap: 18,
              minHeight: 120,
              boxShadow: "0 2px 8px -1px rgba(23,27,28,.10)",
            }}
          >
            <span
              style={{
                width: 44,
                height: 44,
                flex: "0 0 auto",
                borderRadius: 12,
                background: iconBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <Icon size={21} strokeWidth={1.6} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span
                title={formatNaira(kpis[kpi])}
                style={{
                  fontFamily: FONTS.display,
                  fontSize: 28,
                  fontWeight: 700,
                  color: "#fff",
                  letterSpacing: "-.02em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {formatNaira(kpis[kpi])}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: `rgba(255,255,255,${labelOpacity})` }}>{label}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 20 }}>
        {SECONDARY_STATS.map(({ kpi, Icon, label, iconBg, iconColor, valueColor }) => (
          <div
            key={label}
            style={{
              background: "#fff",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              padding: 20,
              display: "flex",
              alignItems: "center",
              gap: 16,
              minHeight: 104,
              boxShadow: "0 1px 2px rgba(23,27,28,.06)",
            }}
          >
            <span
              style={{
                width: 42,
                height: 42,
                flex: "0 0 auto",
                borderRadius: 11,
                background: iconBg,
                color: iconColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={20} strokeWidth={1.6} />
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span
                title={formatNaira(kpis[kpi])}
                style={{
                  fontFamily: FONTS.display,
                  fontSize: 24,
                  fontWeight: 700,
                  letterSpacing: "-.02em",
                  color: valueColor,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {formatNaira(kpis[kpi])}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: COLORS.slateMid,
                }}
              >
                {label}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.72fr) minmax(0,1fr)", gap: 24 }}>
        <SalesPurchasesChart week={week} />
        <DonutCard
          title={`Top Selling Products (${yearOf(now)})`}
          slices={topYear.map((p) => ({ label: p.name, value: p.quantity, detail: `${p.quantity} sold` }))}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.72fr) minmax(0,1fr)", gap: 24, alignItems: "start" }}>
        <TopSellingMayCard month={month} rows={topMonth} />
        <DonutCard
          title={`Top 5 Customers (${month})`}
          headerExtra={
            topCustomers.length === 0 ? (
              <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>No sales recorded in {month} yet.</span>
            ) : (
              // The design's legend chip, one per customer (slice colours).
              <span style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "6px 14px" }}>
                {topCustomers.map((customer, i) => (
                  <span
                    key={customer.customerId}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: COLORS.slate }}
                  >
                    <span
                      style={{ width: 10, height: 10, borderRadius: 3, background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                    />
                    {customer.name}
                  </span>
                ))}
              </span>
            )
          }
          slices={topCustomers.map((customer) => ({
            label: customer.name,
            // Drawn as a number; the tooltip shows the exact Decimal string.
            value: Number(customer.grandTotal),
            detail: formatNaira(customer.grandTotal),
          }))}
        />
      </div>

      <RecentSalesCard rows={recentSales} />
      <StockAlertCard rows={stockAlerts.rows} total={stockAlerts.total} showingAll={showAllStockAlerts} />
    </>
  );
}
