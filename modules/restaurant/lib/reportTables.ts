import type { OrderType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";

// Restaurant Reports › By table and By order type (Step 5), put together
// from what the database added up (server/queries/reports/tables.ts). Pure.
//
//   Net sales     the bills less refunds made in the period
//   Average bill  the bills as settled ÷ orders
//   Turn time     opened → closed, on average
//   Turns per day orders ÷ days in the period
//   Prep time     each order type's lines, sent → Ready (as Prep times)

export type TableOrderRow = { tableId: string; orders: number; covers: number; sales: Decimal.Value; seconds: number };
export type TableInfo = { tableId: string; name: string; areaId: string; area: string; deleted: boolean };

export type TableLine = {
  tableId: string;
  name: string;
  areaId: string;
  area: string;
  deleted: boolean;
  orders: number;
  covers: number;
  net: string;
  averageBill: string | null;
  averageTurnSeconds: number | null;
  turnsPerDay: number;
};

export type TableTotals = Omit<TableLine, "tableId" | "name" | "areaId" | "area" | "deleted">;

const ZERO = new Decimal(0);
const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const turns = (orders: number, days: number) => (days > 0 ? Math.round((orders / days) * 10) / 10 : 0);

function totalsOf(rows: readonly { orders: number; covers: number; net: Decimal; sales: Decimal; seconds: number }[], days: number, tables: number): TableTotals {
  const orders = rows.reduce((n, r) => n + r.orders, 0);
  const sales = rows.reduce((t, r) => t.plus(r.sales), ZERO);
  return {
    orders,
    covers: rows.reduce((n, r) => n + r.covers, 0),
    net: money(rows.reduce((t, r) => t.plus(r.net), ZERO)),
    averageBill: orders > 0 ? money(sales.div(orders)) : null,
    averageTurnSeconds: orders > 0 ? Math.round(rows.reduce((n, r) => n + r.seconds, 0) / orders) : null,
    // A group's turns: per table, on average.
    turnsPerDay: tables > 0 ? turns(orders / tables, days) : 0,
  };
}

export function tableLines(input: { orders: readonly TableOrderRow[]; refunds: readonly { tableId: string; amount: Decimal.Value }[]; info: readonly TableInfo[]; days: number }) {
  const ids = new Set([...input.orders.map((r) => r.tableId), ...input.refunds.map((r) => r.tableId)]);
  const orders = new Map(input.orders.map((r) => [r.tableId, r]));
  const refunds = new Map(input.refunds.map((r) => [r.tableId, new Decimal(r.amount)]));
  const info = new Map(input.info.map((r) => [r.tableId, r]));
  const raw = [...ids].map((tableId) => {
    const o = orders.get(tableId);
    const sales = new Decimal(o?.sales ?? 0);
    const about = info.get(tableId);
    return { tableId, about, orders: o?.orders ?? 0, covers: o?.covers ?? 0, sales, net: sales.minus(refunds.get(tableId) ?? ZERO), seconds: o?.seconds ?? 0 };
  });
  const lines: TableLine[] = raw.map((r) => ({
    tableId: r.tableId,
    name: r.about?.name ?? "Deleted table",
    areaId: r.about?.areaId ?? "",
    area: r.about?.area ?? "—",
    deleted: r.about?.deleted ?? true,
    orders: r.orders,
    covers: r.covers,
    net: money(r.net),
    averageBill: r.orders > 0 ? money(r.sales.div(r.orders)) : null,
    averageTurnSeconds: r.orders > 0 ? Math.round(r.seconds / r.orders) : null,
    turnsPerDay: turns(r.orders, input.days),
  }));
  const areaIds = [...new Set(lines.map((l) => l.areaId))];
  const areas = areaIds
    .map((areaId) => {
      const mine = raw.filter((r) => (r.about?.areaId ?? "") === areaId);
      return { areaId, area: lines.find((l) => l.areaId === areaId)!.area, totals: totalsOf(mine, input.days, mine.length) };
    })
    .sort((a, b) => a.area.localeCompare(b.area));
  return { lines, areas, totals: totalsOf(raw, input.days, raw.length) };
}

// The heat map: each live table's share of the busiest one (0–1), by net
// sales or by turns; tables with nothing are 0.
export type HeatMetric = "net" | "turns";
export function heatOf(lines: readonly TableLine[], metric: HeatMetric): Map<string, { value: number; share: number }> {
  const value = (l: TableLine) => (metric === "net" ? Math.max(0, Number(l.net)) : l.turnsPerDay);
  const max = Math.max(0, ...lines.map(value));
  return new Map(lines.map((l) => [l.tableId, { value: value(l), share: max > 0 ? value(l) / max : 0 }]));
}

// ---- By order type

export const ORDER_TYPES_SHOWN: readonly OrderType[] = ["DINE_IN", "TAKEAWAY", "BAR_TAB", "DELIVERY"];

export type TypeLine = { type: OrderType; orders: number; net: string; averageBill: string | null; share: number | null; prepSeconds: number | null; prepLines: number };

export function typeLines(input: {
  orders: readonly { type: OrderType; orders: number; sales: Decimal.Value }[];
  refunds: readonly { type: OrderType; amount: Decimal.Value }[];
  prep: readonly { type: OrderType; seconds: number; lines: number }[];
}): { lines: TypeLine[]; totals: Omit<TypeLine, "type"> } {
  const types = [...ORDER_TYPES_SHOWN, ...input.orders.map((r) => r.type).filter((t) => !ORDER_TYPES_SHOWN.includes(t))];
  const raw = types.map((type) => {
    const o = input.orders.find((r) => r.type === type);
    const sales = new Decimal(o?.sales ?? 0);
    const net = sales.minus(input.refunds.find((r) => r.type === type)?.amount ?? 0);
    const p = input.prep.find((r) => r.type === type);
    return { type, orders: o?.orders ?? 0, sales, net, prepTotal: p ? p.seconds * p.lines : 0, prepLines: p?.lines ?? 0 };
  });
  const totalNet = raw.reduce((t, r) => t.plus(r.net), ZERO);
  const share = (net: Decimal) => (totalNet.greaterThan(0) ? net.div(totalNet).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber() : null);
  const lines = raw.map((r) => ({
    type: r.type,
    orders: r.orders,
    net: money(r.net),
    averageBill: r.orders > 0 ? money(r.sales.div(r.orders)) : null,
    share: share(r.net),
    prepSeconds: r.prepLines > 0 ? Math.round(r.prepTotal / r.prepLines) : null,
    prepLines: r.prepLines,
  }));
  const orders = raw.reduce((n, r) => n + r.orders, 0);
  const prepLines = raw.reduce((n, r) => n + r.prepLines, 0);
  return {
    lines,
    totals: {
      orders,
      net: money(totalNet),
      averageBill: orders > 0 ? money(raw.reduce((t, r) => t.plus(r.sales), ZERO).div(orders)) : null,
      share: totalNet.greaterThan(0) ? 100 : null,
      prepSeconds: prepLines > 0 ? Math.round(raw.reduce((n, r) => n + r.prepTotal, 0) / prepLines) : null,
      prepLines,
    },
  };
}
