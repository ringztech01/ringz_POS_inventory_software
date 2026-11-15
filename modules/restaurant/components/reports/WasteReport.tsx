import type { ReactNode } from "react";
import { Prisma } from "@prisma/client";
import { ClipboardList, Percent, Tag, Trash2 } from "lucide-react";
import { COLORS } from "@/components/layout/theme";
import { formatNaira } from "@/lib/format";
import { formatQuantity, wasteByDay, wasteHref, wasteKpis, withShares } from "../../lib/reportWaste";
import type { KpiTone } from "../../lib/theme";
import { WASTE_REASON_LABEL } from "../../lib/waste";
import type { ReportWindow } from "../../server/queries/reports/filters";
import type { WasteData } from "../../server/queries/reports/waste";
import DashboardCard from "../dashboard/DashboardCard";
import KpiTile from "../dashboard/KpiTile";
import SalesByDayChart from "./SalesByDayChart";
import SortableTable, { type SortableColumn, type SortableRow } from "./SortableTable";

const money = (v: string) => formatNaira(v);
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const dayLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

const col = (key: string, label: string, width: string, align?: "right"): SortableColumn => ({ key, label, width, align });
export const REASON_COLUMNS = [col("name", "Reason", "minmax(160px,1fr)"), col("count", "Entries", "90px", "right"), col("cost", "Cost", "130px", "right"), col("share", "% of waste", "110px", "right")];
export const ITEM_COLUMNS = [col("name", "Item", "minmax(160px,1fr)"), col("count", "Entries", "90px", "right"), col("quantity", "Quantity", "120px", "right"), col("cost", "Cost", "130px", "right"), col("share", "% of waste", "110px", "right")];
export const USER_COLUMNS = [col("name", "Logged by", "minmax(160px,1fr)"), col("count", "Entries", "90px", "right"), col("cost", "Cost", "130px", "right"), col("share", "% of waste", "110px", "right")];
export const REMAKE_COLUMNS = [col("name", "Dish", "minmax(160px,1fr)"), col("lines", "Remakes", "100px", "right"), col("quantity", "Plates", "90px", "right"), col("cost", "Waste cost", "130px", "right")];

function Section({ title, note, children, data }: { title: string; note?: ReactNode; children: ReactNode; data: string }) {
  return (
    <section aria-label={title} data-waste-section={data} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
      {children}
      {note && <span style={{ fontSize: 12.5, color: COLORS.slateMid }}>{note}</span>}
    </section>
  );
}

const LEVEL_TONE: Record<"ok" | "amber" | "red", KpiTone> = { ok: "green", amber: "amber", red: "rose" };

// Restaurant Reports › Waste (Step 7). A row opens Food › Waste with the
// matching filters (the period's days and that reason, person or item).
// Every table's rows, cells and totals — the page and the Excel export
// (server/reportExport.ts) both use these.
export function wasteTables({ data, window }: { data: WasteData; window: ReportWindow }) {
  const kpis = wasteKpis({ byReason: data.byReason, foodCost: data.foodCost, amber: data.thresholds.amber, red: data.thresholds.red });
  const range = { from: window.from, to: window.to };

  const reasons: SortableRow[] = withShares(data.byReason.map((r) => ({ ...r, cost: r.cost.toFixed(2) }))).map((r) => ({
    id: r.reason,
    cells: { name: WASTE_REASON_LABEL[r.reason], count: String(r.count), cost: money(r.cost), share: pct(r.share) },
    sort: { name: WASTE_REASON_LABEL[r.reason].toLowerCase(), count: r.count, cost: Number(r.cost), share: r.share },
    link: { href: wasteHref(range, { reason: r.reason }), title: `Open Food › Waste: ${WASTE_REASON_LABEL[r.reason]}` },
  }));
  const items = (rows: WasteData["byItem"], linked: boolean): SortableRow[] =>
    withShares(rows.map((r) => ({ ...r, cost: r.cost.toFixed(2) }))).map((r) => ({
      id: r.key,
      cells: { name: r.name, count: String(r.count), quantity: formatQuantity(r.quantity, r.unit), cost: money(r.cost), share: pct(r.share) },
      sort: { name: r.name.toLowerCase(), count: r.count, quantity: Number(r.quantity), cost: Number(r.cost), share: r.share },
      link: linked ? { href: wasteHref(range, { q: r.name }), title: `Open Food › Waste: ${r.name}` } : null,
    }));
  const users: SortableRow[] = withShares(data.byUser.map((r) => ({ ...r, cost: r.cost.toFixed(2) }))).map((r) => ({
    id: r.key,
    cells: { name: r.name, count: String(r.count), cost: money(r.cost), share: pct(r.share) },
    sort: { name: r.name.toLowerCase(), count: r.count, cost: Number(r.cost), share: r.share },
    link: { href: wasteHref(range, { user: r.key }), title: `Open Food › Waste: logged by ${r.name}` },
  }));
  const remakes: SortableRow[] = data.remakes.map((r) => ({
    id: r.productId,
    cells: { name: r.name, lines: String(r.lines), quantity: String(r.quantity), cost: money(r.cost.toFixed(2)) },
    sort: { name: r.name.toLowerCase(), lines: r.lines, quantity: r.quantity, cost: Number(r.cost) },
  }));
  const days = wasteByDay(range, data.byDay.map((d) => ({ day: d.day, cost: d.cost.toFixed(2) })));
  const total = (label: string, extra: Record<string, string> = {}) => ({ name: label, count: String(kpis.entries), cost: money(kpis.total), share: kpis.entries ? "100.0%" : "—", ...extra });
  const ingredientTotal = data.byIngredient.reduce((t, r) => t.plus(r.cost), new Prisma.Decimal(0));
  const levelNote = kpis.level === "red" ? `Over the ${data.thresholds.red.toString()}% red line` : kpis.level === "amber" ? `Over the ${data.thresholds.amber.toString()}% amber line` : `Under the ${data.thresholds.amber.toString()}% amber line`;
  return { kpis, range, reasons, items, users, remakes, days, total, ingredientTotal, levelNote };
}

export default function WasteReport({ data, window, withCost, filtered }: { data: WasteData; window: ReportWindow; withCost: boolean; filtered: boolean }) {
  const { kpis, reasons, items, users, remakes, days, total, ingredientTotal, levelNote } = wasteTables({ data, window });

  if (kpis.entries === 0 && data.remakes.length === 0) {
    return (
      <div data-waste-report data-waste-empty style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "44px 22px", textAlign: "center", fontSize: 13.5, color: COLORS.slateMid }}>
        Nothing was wasted in this period.
      </div>
    );
  }

  return (
    <div data-waste-report style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${withCost ? 4 : 3},minmax(0,1fr))`, gap: 14 }}>
        <KpiTile label="Waste cost" tone="rose" icon={Trash2} value={money(kpis.total)} note={data.remakeEntries ? `${formatNaira(data.remakeCost.toFixed(2))} of it from remakes` : "No remakes"} />
        <KpiTile label="Entries" tone="blue" icon={ClipboardList} value={String(kpis.entries)} note={`${data.byItem.length} ${data.byItem.length === 1 ? "item" : "items"} wasted`} />
        {withCost && (
          <KpiTile
            label="% of food cost"
            tone={kpis.level ? LEVEL_TONE[kpis.level] : "green"}
            icon={Percent}
            value={kpis.share === null ? "—" : `${kpis.share.toFixed(1)}%`}
            note={kpis.share === null ? "No food cost sold in the period" : `${levelNote} · food cost ${formatNaira(data.foodCost!.toFixed(2))}`}
          />
        )}
        <KpiTile label="Top reason" tone="violet" icon={Tag} value={kpis.topReason ? WASTE_REASON_LABEL[kpis.topReason] : "—"} note={kpis.topReason ? `${formatNaira(data.byReason.find((r) => r.reason === kpis.topReason)!.cost.toFixed(2))} of the waste` : "Nothing wasted"} />
      </div>
      {filtered && <span data-waste-note="unfiltered" style={{ fontSize: 12.5, color: COLORS.slateMid }}>All the period&apos;s waste: waste isn&apos;t tied to an area, waiter, order type, station or device, so those filters don&apos;t narrow it.</span>}

      <DashboardCard title="Waste by day">
        <SalesByDayChart days={days.map((d) => ({ ...d, label: dayLabel.format(new Date(`${d.day}T00:00:00.000Z`)).replace(",", "") }))} caption="Waste cost by day" color="#b4233c" fill="rgba(180,35,60,.10)" />
      </DashboardCard>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 18 }}>
        <Section title="By reason" data="reason">
          <SortableTable columns={REASON_COLUMNS} rows={reasons} totals={total("Total")} defaultSort="cost" textColumns={["name"]} data="wreason" param="wr" />
        </Section>
        <Section title="By person" data="user">
          <SortableTable columns={USER_COLUMNS} rows={users} totals={total("Total")} defaultSort="cost" textColumns={["name"]} data="wuser" param="wu" />
        </Section>
      </div>
      <Section title="By item" data="item" note="What was logged: a dish, or an ingredient on its own.">
        <SortableTable columns={ITEM_COLUMNS} rows={items(data.byItem, true)} totals={total("Total", { quantity: "" })} defaultSort="cost" textColumns={["name"]} data="witem" param="wi" />
      </Section>
      <Section title="By ingredient" data="ingredient" note="What came out of stock: a dish wasted is its ingredients by its recipe then. Food › Waste lists entries by item, so these rows don't open it.">
        <SortableTable columns={ITEM_COLUMNS} rows={items(data.byIngredient, false)} totals={{ name: "Total", count: "", quantity: "", cost: money(ingredientTotal.toFixed(2)), share: data.byIngredient.length ? "100.0%" : "—" }} defaultSort="cost" textColumns={["name"]} data="wingredient" param="wg" />
      </Section>
      <Section title="Remakes" data="remakes" note="Kitchen Display › Remake: the free remake lines made in the period, and the waste logged for the spoilt dishes they replaced (part of the waste above).">
        {remakes.length ? (
          <SortableTable columns={REMAKE_COLUMNS} rows={remakes} totals={{ name: "Total", lines: String(data.remakes.reduce((n, r) => n + r.lines, 0)), quantity: String(data.remakes.reduce((n, r) => n + r.quantity, 0)), cost: money(data.remakeCost.toFixed(2)) }} defaultSort="cost" textColumns={["name"]} data="wremake" param="wm" />
        ) : (
          <span style={{ fontSize: 13, color: COLORS.slateMid }}>No remakes in this period.</span>
        )}
      </Section>
    </div>
  );
}
