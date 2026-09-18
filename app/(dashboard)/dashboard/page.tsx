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
import SalesPurchasesChart from "@/components/dashboard/SalesPurchasesChart";
import DonutCard from "@/components/dashboard/DonutCard";
import TopSellingMayCard from "@/components/dashboard/TopSellingMayCard";
import RecentSalesCard from "@/components/dashboard/RecentSalesCard";
import StockAlertCard from "@/components/dashboard/StockAlertCard";

type PrimaryStat = {
  Icon: LucideIcon;
  label: string;
  bg: string;
  iconBg: string;
  labelOpacity: number;
};

const PRIMARY_STATS: PrimaryStat[] = [
  { Icon: ShoppingCart, label: "Sales", bg: "#0f7d6a", iconBg: "rgba(255,255,255,.18)", labelOpacity: 0.88 },
  { Icon: PackagePlus, label: "Purchases", bg: "#073b33", iconBg: "rgba(255,255,255,.16)", labelOpacity: 0.85 },
  { Icon: ArrowRight, label: "Sales Returns", bg: "#1c62a8", iconBg: "rgba(255,255,255,.20)", labelOpacity: 0.88 },
  { Icon: ArrowLeft, label: "Purchases Returns", bg: "#a76a09", iconBg: "rgba(255,255,255,.20)", labelOpacity: 0.9 },
];

type SecondaryStat = {
  Icon: LucideIcon;
  label: string;
  iconBg: string;
  iconColor: string;
  valueColor?: string;
};

const SECONDARY_STATS: SecondaryStat[] = [
  { Icon: CircleDollarSign, label: "Today total sales", iconBg: "#eff8f6", iconColor: COLORS.teal },
  { Icon: Banknote, label: "Today total received (sales)", iconBg: "#e2f4ec", iconColor: "#10805c" },
  { Icon: ShoppingBasket, label: "Today total purchases", iconBg: "#e3eefb", iconColor: "#1c62a8" },
  { Icon: MinusCircle, label: "Today total expense", iconBg: "#fce8e6", iconColor: COLORS.danger, valueColor: COLORS.danger },
];

export default function DashboardPage() {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 20 }}>
        {PRIMARY_STATS.map(({ Icon, label, bg, iconBg, labelOpacity }) => (
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
              <span style={{ fontFamily: FONTS.display, fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: "-.02em" }}>
                ₦0.00
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: `rgba(255,255,255,${labelOpacity})` }}>{label}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 20 }}>
        {SECONDARY_STATS.map(({ Icon, label, iconBg, iconColor, valueColor }) => (
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
                style={{
                  fontFamily: FONTS.display,
                  fontSize: 24,
                  fontWeight: 700,
                  letterSpacing: "-.02em",
                  color: valueColor,
                }}
              >
                ₦0.00
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
        <SalesPurchasesChart />
        <DonutCard title="Top Selling Products (2026)" labels={["No sales"]} data={[1]} colors={["#eceff0"]} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.72fr) minmax(0,1fr)", gap: 24, alignItems: "start" }}>
        <TopSellingMayCard />
        <DonutCard
          title="Top 5 Customers (May)"
          headerExtra={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: COLORS.slate }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS.teal }} />
              direct-customer
            </span>
          }
          labels={["direct-customer"]}
          data={[1]}
          colors={[COLORS.teal]}
          showTooltip
        />
      </div>

      <RecentSalesCard />
      <StockAlertCard />
    </>
  );
}
