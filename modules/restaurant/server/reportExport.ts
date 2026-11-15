import "server-only";
import type { WorkbookCell, WorkbookCellKind, WorkbookColumn, WorkbookSheet } from "@/lib/reports/exportXlsx";
import { PAYMENT_TYPE_LABELS } from "@/components/purchases/purchase-display";
import { averageBill, hourChart } from "../lib/dashboard";
import { orderRef } from "../lib/format";
import { ORDER_TYPE_LABEL } from "../lib/orderLines";
import { dishLines, dishViewFrom, groupDishes, MENU_CLASS_HINT, MENU_CLASS_LABEL, quadrants, sortDishes, type DishLine, type DishTotals } from "../lib/reportDishes";
import { DEPARTMENT_LABEL, foodCostPercent, netByDay, netByDepartment, netByHour, netByType, perCover } from "../lib/reportOverview";
import { resolveSort, sortRows } from "../lib/reportSort";
import { refundTotals, type RefundRow } from "../lib/reportPayments";
import { dayStartLabel, ORDER_TYPE_LABELS, REPORT_TABS, reportDayLabel, type ReportTabKey } from "../lib/reportTabs";
import { voidReason, discountShare, overLimit } from "../lib/reportVoids";
import type { DiscountRow, VoidRow } from "../lib/reportVoids";
import { WASTE_REASON_LABEL } from "../lib/waste";
import type { SortableColumn, SortableRow } from "../components/reports/SortableTable";
import { orderTypeTables, COLUMNS as TYPE_COLUMNS } from "../components/reports/OrderTypeReport";
import { paymentsTables, METHOD_COLUMNS, REFUND_COLUMNS, TIP_METHOD_COLUMNS, TIP_WAITER_COLUMNS } from "../components/reports/PaymentsReport";
import { shiftsTables, SHIFT_COLUMNS, TILL_COLUMNS } from "../components/reports/ShiftsReport";
import { tableReportTables, COLUMNS as TABLE_COLUMNS } from "../components/reports/TableReport";
import { voidsTables, DISCOUNT_COLUMNS, VOID_COLUMNS } from "../components/reports/VoidsReport";
import { waiterTable, COLUMNS as WAITER_COLUMNS } from "../components/reports/WaiterReport";
import { wasteTables, ITEM_COLUMNS, REASON_COLUMNS, REMAKE_COLUMNS, USER_COLUMNS } from "../components/reports/WasteReport";
import type { ReportFilters, ReportWindow } from "./queries/reports/filters";
import type { ReportResult } from "./queries/reports/scope";
import type { ReportSetup } from "./queries/reports/shell";
import { getDishReport } from "./queries/reports/dishes";
import { getOverview } from "./queries/reports/overview";
import { countRefunds, getPaymentsReport, refundPages } from "./queries/reports/payments";
import { getShiftsReport } from "./queries/reports/shifts";
import { getOrderTypeReport, getTableReport } from "./queries/reports/tables";
import { discountPages, getVoidsReport, voidPages } from "./queries/reports/voids";
import { getWaiterReport } from "./queries/reports/waiters";
import { getWasteReport } from "./queries/reports/waste";

// Restaurant Reports' Excel export (Step 10): each tab as a workbook of what
// it shows — its tables, from the same queries, the same lines and the same
// rows (the components' own builders), in the order the URL sorts them —
// with real numbers, money, percentages and dates. Cost and margin only with
// View Cost. Each sheet starts with the business, the report, the period,
// the filters, who made it and when. Lists of more than STREAM_ROWS rows are
// read a page at a time and streamed (newest first, as their default).

export const STREAM_ROWS = 50_000;

export type ExportContext = {
  tab: ReportTabKey;
  window: ReportWindow;
  filters: ReportFilters;
  params: URLSearchParams;
  setup: ReportSetup;
  withCost: boolean;
  canAudit: boolean;
  clockInOut: boolean;
  business: string;
  generatedBy: string;
  now: Date;
  // Tests only: stream above this many rows instead of STREAM_ROWS.
  streamAbove?: number;
};

export type ExportBook = { filename: string; sheets: WorkbookSheet[]; stream: boolean };

type Table = { param: string; columns: readonly SortableColumn[]; defaultSort: string; defaultDir?: "asc" | "desc"; textColumns: readonly string[] };
// A column of a sheet: its heading and kind, and its value for a line.
type Col<L> = { header: string; kind?: WorkbookCellKind; width?: number; value: (line: L) => WorkbookCell };

const money = (v: { toString(): string } | string | null) => (v === null ? null : String(v));
const minutes = (seconds: number | null) => (seconds === null ? null : Math.round(seconds / 60));
const hours = (seconds: number | null) => (seconds === null ? null : Math.round((seconds / 3600) * 100) / 100);

// The on-screen order of a table (its ?<param>sort, ?<param>dir).
function ordered(rows: readonly SortableRow[], table: Table, params: URLSearchParams): SortableRow[] {
  const { sort, dir } = resolveSort(params, table);
  return sortRows(rows, sort, dir, table.columns[0].key);
}

function filterText(ctx: ExportContext): string {
  const f = ctx.filters;
  const name = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? id;
  const parts = [
    f.area && `Dining area: ${name(ctx.setup.areas, f.area)}`,
    f.waiter && `Waiter: ${name(ctx.setup.waiters, f.waiter)}`,
    f.type && `Order type: ${ORDER_TYPE_LABELS[f.type]}`,
    f.station && `Station: ${name(ctx.setup.stations, f.station)}`,
    f.device && `Device: ${name(ctx.setup.devices, f.device)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "None";
}

function info(ctx: ExportContext, sheetTitle: string): WorkbookSheet["info"] {
  const w = ctx.window;
  const days = w.from === w.to ? reportDayLabel(w.from) : `${reportDayLabel(w.from)} – ${reportDayLabel(w.to)}`;
  const tab = REPORT_TABS.find((t) => t.key === ctx.tab)!.label;
  return [
    { label: "Business", value: ctx.business },
    { label: "Report", value: `Restaurant Reports · ${tab} · ${sheetTitle}` },
    { label: "Period", value: `${days}${ctx.setup.dayStartMinutes ? ` (business day from ${dayStartLabel(ctx.setup.dayStartMinutes)})` : ""}` },
    { label: "Filters", value: filterText(ctx) },
    { label: "Generated by", value: ctx.generatedBy },
    { label: "Generated at", value: ctx.now, kind: "datetime" },
  ];
}

function sheet<L>(ctx: ExportContext, name: string, cols: Col<L>[], lines: Iterable<L> | AsyncIterable<L>, totals?: Partial<Record<number, WorkbookCell>> | WorkbookCell[] | null): WorkbookSheet {
  const columns: WorkbookColumn[] = cols.map((c) => ({ header: c.header, kind: c.kind ?? "text", width: c.width ?? Math.max(12, Math.min(40, c.header.length + 4)) }));
  async function* rows() {
    for await (const line of lines as AsyncIterable<L>) yield cols.map((c) => c.value(line));
  }
  const total = totals ? (Array.isArray(totals) ? totals : cols.map((_, i) => (totals as Record<number, WorkbookCell>)[i] ?? null)) : null;
  return { name, info: info(ctx, name), columns, rows: rows(), totals: total };
}

// A sorted table's lines, by row id.
function inOrder<L>(rows: readonly SortableRow[], table: Table, params: URLSearchParams, byId: ReadonlyMap<string, L>): L[] {
  return ordered(rows, table, params).flatMap((r) => (byId.has(r.id) ? [byId.get(r.id)!] : []));
}

// ---------------------------------------------------------------- tabs

async function overview(ctx: ExportContext): Promise<ReportResult<WorkbookSheet[]>> {
  const r = await getOverview(ctx.window, ctx.filters, { dayStartMinutes: ctx.setup.dayStartMinutes, withCost: ctx.withCost });
  if (!r.ok) return r;
  const { current: now, previous: before } = r.data;
  type Fig = { label: string; now: WorkbookCell; before: WorkbookCell };
  const m = (v: string) => ({ value: v, kind: "money" as const });
  const n = (v: number) => ({ value: v, kind: "integer" as const });
  const p = (v: number | null) => ({ value: v, kind: "percent" as const });
  const figures: Fig[] = [
    { label: "Net sales", now: m(now.net.toFixed(2)), before: m(before.net.toFixed(2)) },
    { label: "Bills settled", now: m(now.sales.toFixed(2)), before: m(before.sales.toFixed(2)) },
    { label: "Refunds", now: m(now.refunds.toFixed(2)), before: m(before.refunds.toFixed(2)) },
    { label: "Orders", now: n(now.orders), before: n(before.orders) },
    { label: "Covers", now: n(now.covers), before: n(before.covers) },
    { label: "Average bill", now: m(averageBill(now.sales, now.orders)), before: m(averageBill(before.sales, before.orders)) },
    { label: "Average per cover", now: m(perCover(now.sales, now.covers)), before: m(perCover(before.sales, before.covers)) },
    ...(ctx.withCost && now.cost && before.cost
      ? [
          { label: "Food cost", now: m(now.cost.total.toFixed(2)), before: m(before.cost.total.toFixed(2)) },
          { label: "Food cost %", now: p(foodCostPercent(now.cost.total, now.net)), before: p(foodCostPercent(before.cost.total, before.net)) },
        ]
      : []),
    { label: "Waste cost", now: m(now.waste.toFixed(2)), before: m(before.waste.toFixed(2)) },
    { label: "Tips", now: m(now.tips.toFixed(2)), before: m(before.tips.toFixed(2)) },
  ];
  const hours = hourChart(netByHour(r.data.sales, r.data.refunds)).bars;
  const days = netByDay(ctx.window, r.data.sales, r.data.refunds);
  const types = netByType(r.data.sales, r.data.refunds);
  const typeTotal = types.reduce((t, x) => t + Number(x.net), 0);
  const departments = netByDepartment(r.data.departments.sold, r.data.departments.returned);
  const deptTotal = departments.reduce((t, x) => t + Number(x.net), 0);
  const share = (v: string, total: number) => (total > 0 ? Math.round((Number(v) / total) * 1000) / 10 : null);
  return {
    ok: true,
    data: [
      sheet<Fig>(ctx, "Summary", [{ header: "Figure", width: 22, value: (f) => f.label }, { header: "This period", width: 16, value: (f) => f.now }, { header: "Previous period", width: 16, value: (f) => f.before }], figures),
      sheet(ctx, "Sales by hour", [{ header: "Hour", value: (b: (typeof hours)[number]) => `${b.label}:00` }, { header: "Net sales", kind: "money", value: (b) => b.total }], hours, ["Total", now.net.toFixed(2)]),
      sheet(ctx, "Sales by day", [{ header: "Day", kind: "date", value: (d: (typeof days)[number]) => new Date(`${d.day}T00:00:00.000Z`) }, { header: "Net sales", kind: "money", value: (d) => d.total }], days, ["Total", now.net.toFixed(2)]),
      sheet(
        ctx,
        "Order type",
        [
          { header: "Order type", value: (t: (typeof types)[number]) => ORDER_TYPE_LABEL[t.type] },
          { header: "Orders", kind: "integer", value: (t) => t.orders },
          { header: "Net sales", kind: "money", value: (t) => t.net },
          { header: "% of net sales", kind: "percent", value: (t) => share(t.net, typeTotal) },
        ],
        types,
        ["Total", now.orders, now.net.toFixed(2), typeTotal > 0 ? 100 : null],
      ),
      sheet(
        ctx,
        "Food vs Bar",
        [
          { header: "Department", value: (d: (typeof departments)[number]) => DEPARTMENT_LABEL[d.department] },
          { header: "Item sales", kind: "money", value: (d) => d.net },
          { header: "% of item sales", kind: "percent", value: (d) => share(d.net, deptTotal) },
        ],
        departments,
        ["Total", deptTotal.toFixed(2), deptTotal > 0 ? 100 : null],
      ),
    ],
  };
}

async function dishes(ctx: ExportContext): Promise<ReportResult<WorkbookSheet[]>> {
  const r = await getDishReport(ctx.window, ctx.filters, { withCost: ctx.withCost });
  if (!r.ok) return r;
  const { lines, totals } = dishLines(r.data);
  const view = dishViewFrom(ctx.params, ctx.withCost);
  const sorted = sortDishes(lines, view.sort, view.dir);
  // A dish, or (grouped) a department's / group's subtotal.
  type Row = { kind: "dish"; line: DishLine } | { kind: "subtotal"; label: string; totals: DishTotals };
  const rows: Row[] = view.grouped
    ? groupDishes(sorted, ctx.withCost).flatMap((d) => [
        { kind: "subtotal" as const, label: DEPARTMENT_LABEL[d.department], totals: d.totals },
        ...d.groups.flatMap((g) => [{ kind: "subtotal" as const, label: `  ${g.group ?? "No group"}`, totals: g.totals }, ...g.lines.map((line) => ({ kind: "dish" as const, line }))]),
      ])
    : sorted.map((line) => ({ kind: "dish" as const, line }));
  const of = <T,>(dish: (l: DishLine) => T, sub: (t: DishTotals) => T | null) => (row: Row) => (row.kind === "dish" ? dish(row.line) : sub(row.totals));
  const totalNet = Number(totals.net);
  const cols: Col<Row>[] = [
    { header: "Dish", width: 28, value: (row) => (row.kind === "dish" ? row.line.name : row.label) },
    { header: "Department", value: of((l) => (l.department === "NONE" ? null : DEPARTMENT_LABEL[l.department]), () => null) },
    { header: "Group", width: 20, value: of((l) => l.group, () => null) },
    { header: "Qty sold", kind: "integer", value: of((l) => l.quantity, (t) => t.quantity) },
    { header: "Gross sales", kind: "money", value: of((l) => l.gross, (t) => t.gross) },
    { header: "Discounts", kind: "money", value: of((l) => l.discount, (t) => t.discount) },
    { header: "Net sales", kind: "money", value: of((l) => l.net, (t) => t.net) },
    ...(ctx.withCost
      ? ([
          { header: "Food cost", kind: "money", value: of((l) => l.cost, (t) => t.cost) },
          { header: "Margin", kind: "money", value: of((l) => l.margin, (t) => t.margin) },
          { header: "Margin %", kind: "percent", value: of((l) => l.marginPct, (t) => t.marginPct) },
        ] satisfies Col<Row>[])
      : []),
    { header: "% of sales", kind: "percent", value: of((l) => l.share, (t) => (totalNet > 0 ? Math.round((Number(t.net) / totalNet) * 1000) / 10 : null)) },
    { header: "86'd (minutes)", kind: "integer", value: of((l) => l.minutes86, () => null) },
    ...(view.engineering ? ([{ header: "Class", value: of((l) => (l.menuClass ? MENU_CLASS_LABEL[l.menuClass] : "Not classed"), () => null) }] satisfies Col<Row>[]) : []),
  ];
  const totalRow: WorkbookCell[] = cols.map((c) => (c.header === "Dish" ? "Total" : c.value({ kind: "subtotal", label: "", totals })));
  const options = sorted.flatMap((l) => l.modifiers.map((m) => ({ dish: l.name, ...m })));
  const sheets = [sheet(ctx, "By dish", cols, rows, totalRow)];
  if (options.length) {
    sheets.push(
      sheet(
        ctx,
        "Options",
        [
          { header: "Dish", width: 28, value: (o: (typeof options)[number]) => o.dish },
          { header: "Option", width: 22, value: (o) => o.name },
          { header: "Group", width: 18, value: (o) => o.group },
          { header: "Times chosen", kind: "integer", value: (o) => o.times },
          { header: "Price changes", kind: "money", value: (o) => o.revenue },
        ],
        options,
      ),
    );
  }
  if (view.engineering) {
    const q = quadrants(lines);
    const classes = (["STAR", "PUZZLE", "PLOWHORSE", "DOG"] as const).map((k) => ({ k, ...q[k] }));
    sheets.push(
      sheet(
        ctx,
        "Menu engineering",
        [
          { header: "Class", value: (c: (typeof classes)[number]) => MENU_CLASS_LABEL[c.k] },
          { header: "Dishes", kind: "integer", value: (c) => c.dishes },
          { header: "Net sales", kind: "money", value: (c) => c.net },
          { header: "What it means", width: 50, value: (c) => MENU_CLASS_HINT[c.k] },
        ],
        classes,
      ),
    );
  }
  return { ok: true, data: sheets };
}

async function waiters(ctx: ExportContext): Promise<ReportResult<WorkbookSheet[]>> {
  const r = await getWaiterReport(ctx.window, ctx.filters);
  if (!r.ok) return r;
  const { lines, totals, rows } = waiterTable(r.data);
  type L = (typeof lines)[number];
  const byId = new Map(lines.map((l) => [l.userId ?? "none", l]));
  const cols: Col<L>[] = [
    { header: "Waiter", width: 24, value: (l) => l.name },
    { header: "Orders", kind: "integer", value: (l) => l.orders },
    { header: "Covers", kind: "integer", value: (l) => l.covers },
    { header: "Net sales", kind: "money", value: (l) => l.net },
    { header: "Average bill", kind: "money", value: (l) => l.averageBill },
    { header: "Tips", kind: "money", value: (l) => l.tips },
    { header: "Discounts given", kind: "integer", value: (l) => l.discounts },
    { header: "Discount amount", kind: "money", value: (l) => l.discountAmount },
    { header: "Voids", kind: "integer", value: (l) => l.voids },
    { header: "Void value", kind: "money", value: (l) => l.voidValue },
    { header: "Manager overrides", kind: "integer", value: (l) => l.overrides },
    { header: "Avg table time (minutes)", kind: "integer", value: (l) => minutes(l.averageTableSeconds) },
    { header: "Hours on shift", kind: "decimal", value: (l) => hours(l.shiftSeconds) },
    { header: "Sales per hour", kind: "money", value: (l) => l.salesPerHour },
  ];
  const table: Table = { param: "", columns: WAITER_COLUMNS, defaultSort: "net", textColumns: ["name"] };
  return { ok: true, data: [sheet(ctx, "By waiter", cols, inOrder(rows, table, ctx.params, byId), cols.map((c, i) => (i === 0 ? "Total" : c.value(totals))))] };
}

async function tables(ctx: ExportContext): Promise<ReportResult<WorkbookSheet[]>> {
  const r = await getTableReport(ctx.window, ctx.filters);
  if (!r.ok) return r;
  const { lines, areas, totals, rows } = tableReportTables({ data: r.data, days: ctx.window.days });
  type Row = { name: string; area: string | null; orders: number; covers: number; net: string; averageBill: string | null; turn: number | null; turns: number };
  const asRow = (l: (typeof lines)[number]): Row => ({ name: l.deleted ? `${l.name} (removed)` : l.name, area: l.area, orders: l.orders, covers: l.covers, net: l.net, averageBill: l.averageBill, turn: minutes(l.averageTurnSeconds), turns: l.turnsPerDay });
  const sub = (label: string, t: typeof totals): Row => ({ name: label, area: null, orders: t.orders, covers: t.covers, net: t.net, averageBill: t.averageBill, turn: minutes(t.averageTurnSeconds), turns: t.turnsPerDay });
  const byId = new Map(lines.map((l) => [l.tableId, asRow(l)]));
  const table: Table = { param: "", columns: TABLE_COLUMNS, defaultSort: "net", textColumns: ["name", "area"] };
  const sorted = ordered(rows, table, ctx.params);
  const grouped = ctx.params.get("group") !== "0";
  const list: Row[] = grouped ? areas.flatMap((a) => [sub(`${a.area} — subtotal`, a.totals), ...sorted.filter((s) => s.group === a.areaId).map((s) => byId.get(s.id)!)]) : sorted.map((s) => byId.get(s.id)!);
  const cols: Col<Row>[] = [
    { header: "Table", width: 22, value: (x) => x.name },
    { header: "Area", width: 18, value: (x) => x.area },
    { header: "Orders", kind: "integer", value: (x) => x.orders },
    { header: "Covers", kind: "integer", value: (x) => x.covers },
    { header: "Net sales", kind: "money", value: (x) => x.net },
    { header: "Average bill", kind: "money", value: (x) => x.averageBill },
    { header: "Avg turn time (minutes)", kind: "integer", value: (x) => x.turn },
    { header: "Turns per day", kind: "decimal", value: (x) => x.turns },
  ];
  return { ok: true, data: [sheet(ctx, "By table", cols, list, cols.map((c) => c.value(sub("Total", totals))))] };
}

async function orderTypes(ctx: ExportContext): Promise<ReportResult<WorkbookSheet[]>> {
  const r = await getOrderTypeReport(ctx.window, ctx.filters);
  if (!r.ok) return r;
  const { lines, totals, rows } = orderTypeTables({ data: r.data });
  type L = (typeof lines)[number];
  const byId = new Map(lines.map((l) => [l.type as string, l]));
  const cols: Col<Omit<L, "type"> & { type?: L["type"] }>[] = [
    { header: "Order type", width: 18, value: (l) => (l.type ? ORDER_TYPE_LABEL[l.type] : "Total") },
    { header: "Orders", kind: "integer", value: (l) => l.orders },
    { header: "Net sales", kind: "money", value: (l) => l.net },
    { header: "Average bill", kind: "money", value: (l) => l.averageBill },
    { header: "% of sales", kind: "percent", value: (l) => l.share },
    { header: "Avg prep time (minutes)", kind: "decimal", value: (l) => (l.prepSeconds === null ? null : Math.round((l.prepSeconds / 60) * 10) / 10) },
  ];
  const table: Table = { param: "", columns: TYPE_COLUMNS, defaultSort: "net", textColumns: ["type"] };
  return { ok: true, data: [sheet(ctx, "By order type", cols, inOrder(rows, table, ctx.params, byId), cols.map((c) => c.value(totals)))] };
}

const refundCols: Col<RefundRow>[] = [
  { header: "Date", kind: "datetime", width: 18, value: (r) => r.at },
  { header: "Refund", width: 18, value: (r) => r.reference },
  { header: "Sale", width: 18, value: (r) => r.sale },
  { header: "Order", value: (r) => orderRef(r.orderNumber) },
  { header: "Amount", kind: "money", value: (r) => money(r.amount) },
  { header: "Method", width: 18, value: (r) => r.methods.map((m) => PAYMENT_TYPE_LABELS[m]).join(", ") || null },
  { header: "Refunded by", width: 20, value: (r) => r.by },
  { header: "Back to stock", value: (r) => (r.toStock ? "Yes" : "No") },
];

async function* flat<T>(pages: AsyncIterable<T[]>): AsyncGenerator<T> {
  for await (const page of pages) yield* page;
}

async function payments(ctx: ExportContext): Promise<ReportResult<{ sheets: WorkbookSheet[]; stream: boolean }>> {
  const big = (await countRefunds(ctx.window, ctx.filters)) > (ctx.streamAbove ?? STREAM_ROWS);
  const r = await getPaymentsReport(ctx.window, ctx.filters, { limit: big ? 0 : null });
  if (!r.ok) return r;
  const t = paymentsTables({ data: r.data, knownWaiters: new Set() });
  const methodById = new Map(t.methods.lines.map((l) => [l.method as string, l]));
  const tipById = new Map(t.tips.lines.map((l) => [l.userId, l]));
  const tipMethodById = new Map(t.tipMethods.lines.map((l) => [l.method as string, l]));
  const refundById = new Map(r.data.refunds.map((x) => [x.id, x]));
  const methodCols = [
    { header: "Method", width: 18, value: (l: (typeof t.methods.lines)[number]) => PAYMENT_TYPE_LABELS[l.method] },
    { header: "Payments", kind: "integer" as const, value: (l: (typeof t.methods.lines)[number]) => l.count },
    { header: "Amount", kind: "money" as const, value: (l: (typeof t.methods.lines)[number]) => l.amount },
  ];
  const refundTotal = big ? null : refundTotals(r.data.refunds);
  return {
    ok: true,
    data: {
      stream: big,
      sheets: [
        sheet(ctx, "By payment method", [...methodCols, { header: "% of total", kind: "percent", value: (l) => l.share }], inOrder(t.methodRows, { param: "m", columns: METHOD_COLUMNS, defaultSort: "amount", textColumns: ["method"] }, ctx.params, methodById), ["Total", t.methods.totals.count, t.methods.totals.amount, t.methods.totals.count ? 100 : null]),
        sheet(
          ctx,
          "Tips by waiter",
          [{ header: "Waiter", width: 24, value: (l: (typeof t.tips.lines)[number]) => l.name }, { header: "Tips", kind: "integer", value: (l) => l.count }, { header: "Amount", kind: "money", value: (l) => l.amount }],
          inOrder(t.tipRows, { param: "t", columns: TIP_WAITER_COLUMNS, defaultSort: "amount", textColumns: ["name"] }, ctx.params, tipById),
          ["Total", t.tips.totals.count, t.tips.totals.amount],
        ),
        sheet(ctx, "Tips by method", methodCols, inOrder(t.tipMethodRows, { param: "tm", columns: TIP_METHOD_COLUMNS, defaultSort: "amount", textColumns: ["method"] }, ctx.params, tipMethodById), ["Total", t.tipMethods.totals.count, t.tipMethods.totals.amount]),
        sheet(
          ctx,
          "Refunds",
          refundCols,
          big ? flat(refundPages(ctx.window, ctx.filters)) : inOrder(t.refundRows, { param: "r", columns: REFUND_COLUMNS, defaultSort: "at", textColumns: ["reference", "sale", "methods", "by"] }, ctx.params, refundById),
          refundTotal ? [`${refundTotal.count} refunds`, null, null, null, refundTotal.amount, null, null, `${refundTotal.toStock} of ${refundTotal.count}`] : null,
        ),
      ],
    },
  };
}

async function waste(ctx: ExportContext): Promise<ReportResult<WorkbookSheet[]>> {
  const r = await getWasteReport(ctx.window, { dayStartMinutes: ctx.setup.dayStartMinutes, withCost: ctx.withCost });
  if (!r.ok) return r;
  const d = r.data;
  const t = wasteTables({ data: d, window: ctx.window });
  const total = Number(t.kpis.total);
  const share = (cost: { toString(): string }) => (total > 0 ? Math.round((Number(cost) / total) * 1000) / 10 : null);
  const reasonById = new Map(d.byReason.map((x) => [x.reason as string, x]));
  const itemById = new Map(d.byItem.map((x) => [x.key, x]));
  const ingredientById = new Map(d.byIngredient.map((x) => [x.key, x]));
  const userById = new Map(d.byUser.map((x) => [x.key, x]));
  const remakeById = new Map(d.remakes.map((x) => [x.productId, x]));
  type Item = (typeof d.byItem)[number];
  const itemCols: Col<Item>[] = [
    { header: "Item", width: 26, value: (x) => x.name },
    { header: "Entries", kind: "integer", value: (x) => x.count },
    { header: "Quantity", kind: "decimal", value: (x) => x.quantity.toString() },
    { header: "Unit", value: (x) => x.unit || null },
    { header: "Cost", kind: "money", value: (x) => money(x.cost) },
    { header: "% of waste", kind: "percent", value: (x) => share(x.cost) },
  ];
  const summary = [
    { label: "Waste cost", value: { value: t.kpis.total, kind: "money" as const } },
    { label: "Entries", value: { value: t.kpis.entries, kind: "integer" as const } },
    ...(ctx.withCost ? [{ label: "% of food cost", value: { value: t.kpis.share, kind: "percent" as const } }, { label: "Food cost", value: { value: d.foodCost?.toFixed(2) ?? null, kind: "money" as const } }] : []),
    { label: "Top reason", value: t.kpis.topReason ? WASTE_REASON_LABEL[t.kpis.topReason] : null },
    { label: "Of it from remakes", value: { value: d.remakeCost.toFixed(2), kind: "money" as const } },
  ];
  const ingredientTotal = d.byIngredient.reduce((s, x) => s + Number(x.cost), 0);
  return {
    ok: true,
    data: [
      sheet(ctx, "Summary", [{ header: "Figure", width: 20, value: (f: (typeof summary)[number]) => f.label }, { header: "Value", width: 18, value: (f) => f.value }], summary),
      sheet(
        ctx,
        "By reason",
        [{ header: "Reason", width: 22, value: (x: (typeof d.byReason)[number]) => WASTE_REASON_LABEL[x.reason] }, { header: "Entries", kind: "integer", value: (x) => x.count }, { header: "Cost", kind: "money", value: (x) => money(x.cost) }, { header: "% of waste", kind: "percent", value: (x) => share(x.cost) }],
        inOrder(t.reasons, { param: "wr", columns: REASON_COLUMNS, defaultSort: "cost", textColumns: ["name"] }, ctx.params, reasonById),
        ["Total", t.kpis.entries, t.kpis.total, total > 0 ? 100 : null],
      ),
      sheet(
        ctx,
        "By person",
        [{ header: "Logged by", width: 22, value: (x: (typeof d.byUser)[number]) => x.name }, { header: "Entries", kind: "integer", value: (x) => x.count }, { header: "Cost", kind: "money", value: (x) => money(x.cost) }, { header: "% of waste", kind: "percent", value: (x) => share(x.cost) }],
        inOrder(t.users, { param: "wu", columns: USER_COLUMNS, defaultSort: "cost", textColumns: ["name"] }, ctx.params, userById),
        ["Total", t.kpis.entries, t.kpis.total, total > 0 ? 100 : null],
      ),
      sheet(ctx, "By item", itemCols, inOrder(t.items(d.byItem, true), { param: "wi", columns: ITEM_COLUMNS, defaultSort: "cost", textColumns: ["name"] }, ctx.params, itemById), ["Total", t.kpis.entries, null, null, t.kpis.total, total > 0 ? 100 : null]),
      sheet(
        ctx,
        "By ingredient",
        itemCols.map((c) => (c.header === "Item" ? { ...c, header: "Ingredient" } : c.header === "% of waste" ? { ...c, value: (x: Item) => (ingredientTotal > 0 ? Math.round((Number(x.cost) / ingredientTotal) * 1000) / 10 : null) } : c)),
        inOrder(t.items(d.byIngredient, false), { param: "wg", columns: ITEM_COLUMNS, defaultSort: "cost", textColumns: ["name"] }, ctx.params, ingredientById),
        ["Total", null, null, null, ingredientTotal.toFixed(2), ingredientTotal > 0 ? 100 : null],
      ),
      sheet(
        ctx,
        "Remakes",
        [{ header: "Dish", width: 26, value: (x: (typeof d.remakes)[number]) => x.name }, { header: "Remakes", kind: "integer", value: (x) => x.lines }, { header: "Plates", kind: "integer", value: (x) => x.quantity }, { header: "Waste cost", kind: "money", value: (x) => money(x.cost) }],
        inOrder(t.remakes, { param: "wm", columns: REMAKE_COLUMNS, defaultSort: "cost", textColumns: ["name"] }, ctx.params, remakeById),
        ["Total", d.remakes.reduce((n, x) => n + x.lines, 0), d.remakes.reduce((n, x) => n + x.quantity, 0), d.remakeCost.toFixed(2)],
      ),
      sheet(ctx, "Waste by day", [{ header: "Day", kind: "date", value: (x: (typeof t.days)[number]) => new Date(`${x.day}T00:00:00.000Z`) }, { header: "Waste cost", kind: "money", value: (x) => x.total }], t.days, ["Total", t.kpis.total]),
    ],
  };
}

const voidCols: Col<VoidRow>[] = [
  { header: "Date", kind: "datetime", width: 18, value: (v) => v.at },
  { header: "Order", value: (v) => orderRef(v.orderNumber) },
  { header: "Table", value: (v) => v.table },
  { header: "Item", width: 24, value: (v) => v.item },
  { header: "Qty", kind: "integer", value: (v) => v.quantity },
  { header: "Value", kind: "money", value: (v) => money(v.value) },
  { header: "Waiter", width: 20, value: (v) => v.waiter },
  { header: "Voided by", width: 20, value: (v) => v.voidedBy },
  { header: "Reason", width: 24, value: (v) => voidReason(v.reason) },
  { header: "Approved by", width: 20, value: (v) => v.approvedBy },
];

async function voids(ctx: ExportContext): Promise<ReportResult<{ sheets: WorkbookSheet[]; stream: boolean }>> {
  const head = await getVoidsReport(ctx.window, ctx.filters, { limit: 0 });
  if (!head.ok) return head;
  const above = ctx.streamAbove ?? STREAM_ROWS;
  const big = head.data.totals.voids.count > above || head.data.totals.discounts.count > above;
  const r = big ? head : await getVoidsReport(ctx.window, ctx.filters, { limit: null });
  if (!r.ok) return r;
  const t = voidsTables({ data: r.data, window: ctx.window, canAudit: false });
  const limit = r.data.limitPercent;
  const discountCols: Col<DiscountRow>[] = [
    { header: "Order", value: (d) => orderRef(d.orderNumber) },
    { header: "Settled", kind: "datetime", width: 18, value: (d) => d.at },
    { header: "Type", value: (d) => (d.type === "PERCENT" ? "Percent" : "Amount") },
    // 10 (%) or 2500 (₦): the number asked for; Type says which.
    { header: "Value", kind: "decimal", value: (d) => money(d.value) },
    { header: "Amount", kind: "money", value: (d) => money(d.amount) },
    { header: "% of bill", kind: "percent", value: (d) => discountShare(d.amount, d.items) },
    { header: "Over the limit", value: (d) => (overLimit(discountShare(d.amount, d.items), limit) ? "Yes" : "No") },
    { header: "Reason", width: 24, value: (d) => d.reason },
    { header: "Applied by", width: 20, value: (d) => d.appliedBy },
    { header: "Approved by", width: 20, value: (d) => d.approvedBy },
  ];
  const totals = r.data.totals;
  const summary = [
    { label: "Voids", value: { value: totals.voids.count, kind: "integer" as const } },
    { label: "Voided value", value: { value: totals.voids.value.toFixed(2), kind: "money" as const } },
    { label: "Voids a manager approved", value: { value: totals.voids.approved, kind: "integer" as const } },
    { label: "Discounts", value: { value: totals.discounts.count, kind: "integer" as const } },
    { label: "Discounted", value: { value: totals.discounts.amount.toFixed(2), kind: "money" as const } },
    { label: "Discounts a manager approved", value: { value: totals.discounts.approved, kind: "integer" as const } },
    { label: "Discount limit", value: { value: Number(limit), kind: "percent" as const } },
  ];
  const voidById = new Map(r.data.voids.map((v) => [v.id, v]));
  const discountById = new Map(r.data.discounts.map((d) => [d.orderId, d]));
  return {
    ok: true,
    data: {
      stream: big,
      sheets: [
        sheet(ctx, "Summary", [{ header: "Figure", width: 28, value: (f: (typeof summary)[number]) => f.label }, { header: "Value", width: 16, value: (f) => f.value }], summary),
        sheet(ctx, "Voids", voidCols, big ? flat(voidPages(ctx.window, ctx.filters)) : inOrder(t.voidRows, { param: "v", columns: VOID_COLUMNS, defaultSort: "at", textColumns: ["table", "item", "waiter", "voidedBy", "reason", "approvedBy"] }, ctx.params, voidById), [`${totals.voids.count} voids`, null, null, null, null, totals.voids.value.toFixed(2)]),
        sheet(ctx, "Discounts", discountCols, big ? flat(discountPages(ctx.window, ctx.filters)) : inOrder(t.discountRows, { param: "d", columns: DISCOUNT_COLUMNS, defaultSort: "at", textColumns: ["type", "reason", "appliedBy", "approvedBy"] }, ctx.params, discountById), [`${totals.discounts.count} bills`, null, null, null, totals.discounts.amount.toFixed(2)]),
      ],
    },
  };
}

async function shifts(ctx: ExportContext): Promise<ReportResult<WorkbookSheet[]>> {
  const r = await getShiftsReport(ctx.window, ctx.filters);
  if (!r.ok) return r;
  const t = shiftsTables({ data: r.data });
  const shiftById = new Map(t.shifts.lines.map((s) => [s.id, s]));
  const tillById = new Map(t.tills.lines.map((x) => [x.id, x]));
  type S = (typeof t.shifts.lines)[number];
  type T = (typeof t.tills.lines)[number];
  return {
    ok: true,
    data: [
      sheet<S>(
        ctx,
        "Shifts",
        [
          { header: "Staff", width: 22, value: (s) => s.name },
          { header: "Role", width: 16, value: (s) => s.role },
          { header: "Clock in", kind: "datetime", width: 18, value: (s) => s.startedAt },
          { header: "Clock out", kind: "datetime", width: 18, value: (s) => s.endedAt },
          { header: "Hours", kind: "decimal", value: (s) => hours(s.seconds) },
          { header: "Orders", kind: "integer", value: (s) => s.orders },
          { header: "Net sales", kind: "money", value: (s) => s.net },
          { header: "Tables handed over", kind: "integer", value: (s) => s.handedOver },
          { header: "Handed to", width: 20, value: (s) => (s.handedOver ? s.handedTo : null) },
        ],
        inOrder(t.shiftRows, { param: "s", columns: SHIFT_COLUMNS, defaultSort: "in", textColumns: ["name", "role", "handed"] }, ctx.params, shiftById),
        [`${t.shifts.totals.shifts} shifts`, null, null, null, hours(t.shifts.totals.seconds), t.shifts.totals.orders, t.shifts.totals.net, t.shifts.totals.handedOver, null],
      ),
      sheet<T>(
        ctx,
        "Cash-up",
        [
          { header: "Till", width: 20, value: (x) => x.device },
          { header: "Opened", kind: "datetime", width: 18, value: (x) => x.openedAt },
          { header: "Opened by", width: 18, value: (x) => x.openedBy },
          { header: "Closed", kind: "datetime", width: 18, value: (x) => x.closedAt },
          { header: "Float", kind: "money", value: (x) => money(x.float) },
          { header: "Cash sales", kind: "money", value: (x) => money(x.cashSales) },
          { header: "Cash tips", kind: "money", value: (x) => money(x.cashTips) },
          { header: "Cash refunds", kind: "money", value: (x) => money(x.cashRefunds) },
          { header: "Drawer opens", kind: "integer", value: (x) => x.drawerOpens },
          { header: "By hand", kind: "integer", value: (x) => x.drawerByHand },
          { header: "Expected", kind: "money", value: (x) => x.expected },
          { header: "Counted", kind: "money", value: (x) => money(x.counted) },
          { header: "Variance", kind: "money", value: (x) => x.variance },
          { header: "Over the limit", value: (x) => (x.open ? null : x.overLimit ? "Yes" : "No") },
        ],
        inOrder(t.tillRows, { param: "c", columns: TILL_COLUMNS, defaultSort: "opened", textColumns: ["device"] }, ctx.params, tillById),
        [`${t.tills.totals.tills} sessions`, null, null, null, null, t.tills.totals.cashSales, null, t.tills.totals.cashRefunds, t.tills.totals.drawerOpens, null, null, null, t.tills.totals.variance, null],
      ),
    ],
  };
}

// ------------------------------------------------------------ the book

const FILE_TAB: Record<ReportTabKey, string> = { overview: "Overview", dishes: "By-dish", waiters: "By-waiter", tables: "By-table", "order-types": "By-order-type", payments: "Payments-and-tips", waste: "Waste", voids: "Voids-and-discounts", shifts: "Shifts-and-cash-up" };

export async function buildReportExport(ctx: ExportContext): Promise<ReportResult<ExportBook>> {
  try {
    const plain = (r: ReportResult<WorkbookSheet[]>): ReportResult<{ sheets: WorkbookSheet[]; stream: boolean }> => (r.ok ? { ok: true, data: { sheets: r.data, stream: false } } : r);
    const built =
      ctx.tab === "overview" ? plain(await overview(ctx))
      : ctx.tab === "dishes" ? plain(await dishes(ctx))
      : ctx.tab === "waiters" ? plain(await waiters(ctx))
      : ctx.tab === "tables" ? plain(await tables(ctx))
      : ctx.tab === "order-types" ? plain(await orderTypes(ctx))
      : ctx.tab === "payments" ? await payments(ctx)
      : ctx.tab === "waste" ? plain(await waste(ctx))
      : ctx.tab === "voids" ? await voids(ctx)
      : plain(await shifts(ctx));
    if (!built.ok) return built;
    const period = ctx.window.from === ctx.window.to ? ctx.window.from : `${ctx.window.from}_to_${ctx.window.to}`;
    return { ok: true, data: { filename: `Restaurant-${FILE_TAB[ctx.tab]}-${period}.xlsx`, ...built.data } };
  } catch (error) {
    console.error("[restaurant] reports: export failed:", error);
    return { ok: false, error: "The export couldn't be made. Please try again." };
  }
}
