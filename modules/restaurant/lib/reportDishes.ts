import { Decimal } from "@prisma/client/runtime/index-browser";
import type { DepartmentKey } from "./reportOverview";

// Restaurant Reports › By dish (Step 3), put together from what the database
// added up per product (server/queries/reports/dishes.ts). Pure.
//
//   Gross sales  the item's Sale lines (with tax, the modifiers' prices in)
//   Discounts    its share of each bill's discount, by its line's share of
//                the bill's items (the restaurant discounts whole bills)
//   Net sales    gross − discounts − its refunds made in the period (each
//                refund line less its share of that refund's discount)
//   Food cost    its lines' cost at settle (OrderItem.unitCost)
// Item sales leave out the service charge, so the dishes add up to the
// items, not to the Overview's net sales.

export type DishSalesRow = { productId: string; quantity: number; gross: Decimal.Value; discount: Decimal.Value };
export type DishRefundRow = { productId: string; quantity: number; amount: Decimal.Value };
export type DishCostRow = { productId: string; cost: Decimal.Value; quantity: number; missingQuantity: number };
export type DishInfo = { productId: string; name: string; department: DepartmentKey; group: string | null };
export type ModifierRow = { productId: string; group: string | null; name: string; times: number; revenue: Decimal.Value };

export type MenuClass = "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG";
export const MENU_CLASS_LABEL: Record<MenuClass, string> = { STAR: "Star", PLOWHORSE: "Plowhorse", PUZZLE: "Puzzle", DOG: "Dog" };
export const MENU_CLASS_HINT: Record<MenuClass, string> = {
  STAR: "Popular and profitable: keep it as it is.",
  PLOWHORSE: "Popular, less profitable: look at its price or cost.",
  PUZZLE: "Profitable, not popular: promote it or move it on the menu.",
  DOG: "Neither: consider taking it off.",
};

export type DishLine = {
  productId: string;
  name: string;
  department: DepartmentKey;
  group: string | null;
  quantity: number;
  gross: string;
  discount: string;
  refunds: string;
  net: string;
  // Without View Cost these stay null (not worked out).
  cost: string | null;
  // Some of its lines had no cost (left out of its food cost).
  costMissing: number;
  margin: string | null;
  marginPct: number | null;
  // Its net sales as a share of all the dishes' (1 decimal).
  share: number | null;
  modifiers: { group: string | null; name: string; times: number; revenue: string }[];
  // Minutes 86'd in the period; null before the 86 log began.
  minutes86: number | null;
  menuClass: MenuClass | null;
};

export type DishTotals = { quantity: number; gross: string; discount: string; refunds: string; net: string; cost: string | null; margin: string | null; marginPct: number | null };

const ZERO = new Decimal(0);
const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const pct = (part: Decimal, whole: Decimal) => (whole.greaterThan(0) ? part.div(whole).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber() : null);

export function marginOf(net: Decimal.Value, cost: Decimal.Value | null): { margin: string | null; marginPct: number | null } {
  if (cost === null) return { margin: null, marginPct: null };
  const m = new Decimal(net).minus(cost);
  return { margin: money(m), marginPct: pct(m, new Decimal(net)) };
}

export function dishLines(input: {
  sales: readonly DishSalesRow[];
  refunds: readonly DishRefundRow[];
  costs: readonly DishCostRow[] | null;
  info: readonly DishInfo[];
  modifiers: readonly ModifierRow[];
  minutes86: ReadonlyMap<string, number> | null;
}): { lines: DishLine[]; totals: DishTotals } {
  const ids = new Set([...input.sales.map((r) => r.productId), ...input.refunds.map((r) => r.productId)]);
  const sales = new Map(input.sales.map((r) => [r.productId, r]));
  const refunds = new Map(input.refunds.map((r) => [r.productId, r]));
  const costs = input.costs ? new Map(input.costs.map((r) => [r.productId, r])) : null;
  const info = new Map(input.info.map((r) => [r.productId, r]));

  const raw = [...ids].map((productId) => {
    const s = sales.get(productId);
    const gross = new Decimal(s?.gross ?? 0);
    const discount = new Decimal(s?.discount ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const refund = new Decimal(refunds.get(productId)?.amount ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const c = costs?.get(productId);
    return { productId, quantity: s?.quantity ?? 0, gross, discount, refund, net: gross.minus(discount).minus(refund), cost: costs ? new Decimal(c?.cost ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : null, costMissing: c?.missingQuantity ?? 0, costQuantity: c?.quantity ?? 0 };
  });
  const totalNet = raw.reduce((t, r) => t.plus(r.net), ZERO);

  const lines: DishLine[] = raw.map((r) => {
    const about = info.get(r.productId);
    // No cost at all for any of its lines: unknown, not ₦0.
    const cost = r.cost === null || (r.costQuantity > 0 && r.costMissing === r.costQuantity) ? null : r.cost;
    return {
      productId: r.productId,
      name: about?.name ?? "Deleted item",
      department: about?.department ?? "NONE",
      group: about?.group ?? null,
      quantity: r.quantity,
      gross: money(r.gross),
      discount: money(r.discount),
      refunds: money(r.refund),
      net: money(r.net),
      cost: cost === null ? null : money(cost),
      costMissing: r.costMissing,
      ...(r.cost === null ? { margin: null, marginPct: null } : marginOf(r.net, cost)),
      share: pct(r.net, totalNet),
      modifiers: input.modifiers
        .filter((m) => m.productId === r.productId)
        .map((m) => ({ group: m.group, name: m.name, times: m.times, revenue: money(new Decimal(m.revenue)) }))
        .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name)),
      minutes86: input.minutes86 ? (input.minutes86.get(r.productId) ?? 0) : null,
      menuClass: null,
    };
  });

  const classes = input.costs ? classify(lines) : new Map<string, MenuClass>();
  for (const line of lines) line.menuClass = classes.get(line.productId) ?? null;

  const sum = (pick: (r: (typeof raw)[number]) => Decimal) => raw.reduce((t, r) => t.plus(pick(r)), ZERO);
  const totalCost = input.costs ? lines.reduce((t, l) => t.plus(l.cost ?? 0), ZERO) : null;
  return {
    lines,
    totals: {
      quantity: raw.reduce((n, r) => n + r.quantity, 0),
      gross: money(sum((r) => r.gross)),
      discount: money(sum((r) => r.discount)),
      refunds: money(sum((r) => r.refund)),
      net: money(totalNet),
      cost: totalCost === null ? null : money(totalCost),
      ...(totalCost === null ? { margin: null, marginPct: null } : marginOf(totalNet, totalCost)),
    },
  };
}

// Menu engineering: each dish against the average of the dishes with a
// full cost (and some sold) — popular when it sold at least the average
// quantity, profitable when its margin per plate is at least the average
// margin per plate (all their margin ÷ all their plates). Dishes with
// missing costs aren't classed.
export function classify(lines: readonly Pick<DishLine, "productId" | "quantity" | "margin" | "costMissing">[]): Map<string, MenuClass> {
  const eligible = lines.filter((l) => l.quantity > 0 && l.margin !== null && l.costMissing === 0);
  const out = new Map<string, MenuClass>();
  if (eligible.length === 0) return out;
  const averageQuantity = new Decimal(eligible.reduce((n, l) => n + l.quantity, 0)).div(eligible.length);
  const averageMargin = eligible.reduce((t, l) => t.plus(l.margin!), ZERO).div(eligible.reduce((n, l) => n + l.quantity, 0));
  for (const l of eligible) {
    const popular = new Decimal(l.quantity).greaterThanOrEqualTo(averageQuantity);
    const profitable = new Decimal(l.margin!).div(l.quantity).greaterThanOrEqualTo(averageMargin);
    out.set(l.productId, popular ? (profitable ? "STAR" : "PLOWHORSE") : profitable ? "PUZZLE" : "DOG");
  }
  return out;
}

// The four quadrants: how many dishes, their net sales.
export function quadrants(lines: readonly Pick<DishLine, "menuClass" | "net">[]): Record<MenuClass, { dishes: number; net: string }> {
  const out = { STAR: { dishes: 0, net: ZERO }, PLOWHORSE: { dishes: 0, net: ZERO }, PUZZLE: { dishes: 0, net: ZERO }, DOG: { dishes: 0, net: ZERO } };
  for (const l of lines) {
    if (!l.menuClass) continue;
    out[l.menuClass].dishes += 1;
    out[l.menuClass].net = out[l.menuClass].net.plus(l.net);
  }
  return {
    STAR: { dishes: out.STAR.dishes, net: money(out.STAR.net) },
    PLOWHORSE: { dishes: out.PLOWHORSE.dishes, net: money(out.PLOWHORSE.net) },
    PUZZLE: { dishes: out.PUZZLE.dishes, net: money(out.PUZZLE.net) },
    DOG: { dishes: out.DOG.dishes, net: money(out.DOG.net) },
  };
}

// Sorting the table: a column, either way; dishes then by name.
export const DISH_SORTS = ["name", "department", "group", "quantity", "gross", "discount", "net", "cost", "margin", "marginPct", "share", "minutes86"] as const;
export type DishSort = (typeof DISH_SORTS)[number];

export function sortDishes<T extends DishLine>(lines: readonly T[], sort: DishSort, dir: "asc" | "desc"): T[] {
  const text = (l: T) => (sort === "name" ? l.name : sort === "department" ? l.department : sort === "group" ? (l.group ?? "") : "");
  const num = (l: T): number | null => {
    const v = l[sort as Exclude<DishSort, "name" | "department" | "group">];
    return v === null || v === undefined ? null : Number(v);
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...lines].sort((a, b) => {
    if (sort === "name" || sort === "department" || sort === "group") {
      const c = text(a).localeCompare(text(b));
      if (c !== 0) return sign * c;
    } else {
      const x = num(a);
      const y = num(b);
      // Unknown (no cost, no log) last either way.
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      if (x !== null && y !== null && x !== y) return sign * (x - y);
    }
    return a.name.localeCompare(b.name);
  });
}

// Grouped: department (Food, Bar, then not on a button), then its group,
// each with a subtotal — the dishes in each in the chosen order.
export type DishGroup<T> = { key: string; department: DepartmentKey; group: string | null; lines: T[]; totals: DishTotals };
export function groupDishes<T extends DishLine>(lines: readonly T[], withCost: boolean): { department: DepartmentKey; groups: DishGroup<T>[]; totals: DishTotals }[] {
  const order: DepartmentKey[] = ["FOOD", "BAR", "NONE"];
  return order
    .map((department) => {
      const mine = lines.filter((l) => l.department === department);
      const names = [...new Set(mine.map((l) => l.group ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
      const groups = names.map((name) => {
        const inGroup = mine.filter((l) => (l.group ?? "") === name);
        return { key: `${department}:${name}`, department, group: name || null, lines: inGroup, totals: subtotal(inGroup, withCost) };
      });
      return { department, groups, totals: subtotal(mine, withCost) };
    })
    .filter((d) => d.groups.length > 0);
}

export function subtotal(lines: readonly DishLine[], withCost: boolean): DishTotals {
  const sum = (pick: (l: DishLine) => string) => lines.reduce((t, l) => t.plus(pick(l)), ZERO);
  const net = sum((l) => l.net);
  const cost = withCost ? sum((l) => l.cost ?? "0") : null;
  return {
    quantity: lines.reduce((n, l) => n + l.quantity, 0),
    gross: money(sum((l) => l.gross)),
    discount: money(sum((l) => l.discount)),
    refunds: money(sum((l) => l.refunds)),
    net: money(net),
    cost: cost === null ? null : money(cost),
    ...(cost === null ? { margin: null, marginPct: null } : marginOf(net, cost)),
  };
}

// The table as the URL has it (?sort ?dir ?group=1 ?view=engineering): a
// cost column's sort, and menu engineering, only with View Cost. The page
// and the Excel export both read it this way.
export function dishViewFrom(params: { get(name: string): string | null }, withCost: boolean): { sort: DishSort; dir: "asc" | "desc"; grouped: boolean; engineering: boolean } {
  const asked = params.get("sort");
  const sort: DishSort = DISH_SORTS.includes(asked as DishSort) && (withCost || !["cost", "margin", "marginPct"].includes(asked!)) ? (asked as DishSort) : "net";
  const given = params.get("dir");
  const dir: "asc" | "desc" = given === "asc" || given === "desc" ? given : ["name", "department", "group"].includes(sort) ? "asc" : "desc";
  return { sort, dir, grouped: params.get("group") === "1", engineering: withCost && params.get("view") === "engineering" };
}
