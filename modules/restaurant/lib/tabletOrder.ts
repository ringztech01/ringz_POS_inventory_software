import type { Department } from "./posGrid";
import type { PosMenuTree } from "./posMenu";
import { groupPath } from "./posMenu";
import type { FlowGroup } from "./optionFlow";

// The tablet's Order screen (Part 6g Step 5): what the menu shows for a
// department and a group, what each line on the check says, and the order's
// own words. Pure — the menu tree, the dishes, the lines and the prices are
// the desktop POS's own (server/queries/orderScreen); nothing is priced here.

type Card = { id: string; name: string; price: string; requiredOptions: boolean; unavailable: "off" | "out" | null };

export type MenuTile =
  | { kind: "group"; id: string; name: string; colour: string; count: number }
  | { kind: "item"; id: string; name: string; price: string; colour: string; required: boolean; soldOut: boolean };

// The department's top groups (the 4-column row), in the desktop's order.
export function topGroups(tree: Pick<PosMenuTree, "row" | "groups">, department: Department): { id: string; name: string; colour: string }[] {
  return (tree.row[department] ?? []).map((id) => tree.groups[id]).filter(Boolean).map((g) => ({ id: g.id, name: g.name, colour: g.colour }));
}

// A group's own tiles: its sub-groups (with how many dishes are in them) and
// dishes, in the order the desktop places them; empty cells left out. A
// dish shows in its top group's colour.
export function groupTiles(tree: Pick<PosMenuTree, "grids" | "groups">, items: readonly Card[], groupId: string): MenuTile[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const path = groupPath(tree, groupId);
  const colour = tree.groups[path[0] ?? groupId]?.colour ?? "#1C1F23";
  const cells = (tree.grids[groupId] ?? []).filter((c): c is NonNullable<typeof c> => c !== null);
  const tiles: MenuTile[] = [];
  for (const cell of cells) {
    if (cell.kind === "group") {
      const node = tree.groups[cell.id];
      if (!node) continue;
      const count = (tree.grids[cell.id] ?? []).filter((c) => c?.kind === "item").length;
      tiles.push({ kind: "group", id: node.id, name: node.name, colour, count });
    } else {
      const card = byId.get(cell.id);
      if (!card) continue;
      tiles.push({ kind: "item", id: card.id, name: card.name, price: card.price, colour, required: card.requiredOptions, soldOut: card.unavailable !== null });
    }
  }
  return tiles;
}

// "Grills › Suya": where a sub-group sits.
export function crumb(tree: Pick<PosMenuTree, "groups">, groupId: string): string {
  return groupPath(tree, groupId)
    .map((id) => tree.groups[id]?.name ?? "")
    .filter(Boolean)
    .join(" › ");
}

// A line's tag on the check.
export type LineTag = "NEW" | "SENT" | "VOID";
export function lineTag(line: { cancelled: boolean; sentAt: string | null }): LineTag {
  if (line.cancelled) return "VOID";
  return line.sentAt ? "SENT" : "NEW";
}

// The ORDER bar: how many items, and how many of them aren't sent yet.
export function orderCounts(lines: readonly { quantity: number; cancelled: boolean; sentAt: string | null }[], pending = 0): { items: number; notSent: number } {
  const live = lines.filter((l) => !l.cancelled);
  return {
    items: live.reduce((n, l) => n + l.quantity, 0) + pending,
    notSent: live.filter((l) => !l.sentAt).reduce((n, l) => n + l.quantity, 0) + pending,
  };
}

// The header: "Table 5", "Takeaway · ORD-0123", "Tab · Ada".
export function orderTitle(order: { type: string; tableName: string | null; tabName: string | null; ref: string }): string {
  if (order.type === "BAR_TAB") return `Tab · ${order.tabName ?? order.ref}`;
  if (order.type === "TAKEAWAY" || !order.tableName) return `Takeaway · ${order.ref}`;
  return /^\d+$/.test(order.tableName) ? `Table ${order.tableName}` : order.tableName;
}

// "4 guests · Ada O.".
export function orderMeta(guests: number, waiter: string | null): string {
  return [guests ? `${guests} ${guests === 1 ? "guest" : "guests"}` : null, waiter].filter(Boolean).join(" · ");
}

// The options sheet's steps: every group in turn — the required ones first,
// in the dish's order, then each optional one (Skip / Done).
export function tabletSteps(groups: readonly FlowGroup[]): FlowGroup[] {
  return [...groups.filter((g) => g.minSelect >= 1), ...groups.filter((g) => g.minSelect < 1)];
}

// A shown price as a number ("₦3,500.00" → 3500, "+₦500" → 500, "−₦500" →
// -500): only for the sheet's running price, which the server prices again.
export function priceOf(text: string): number {
  const value = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(value)) return 0;
  return /^[−-]/.test(text.trim()) ? -value : value;
}

// "₦4,700" — the running price, no kobo when there are none.
export function naira(value: number): string {
  const fixed = Math.round(value * 100) / 100;
  return `₦${fixed.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(fixed) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// "Sent to Kitchen + Bar", from what SEND sent where.
export function sentTo(sent: readonly { station: string; count: number }[]): string | null {
  const stations = sent.filter((s) => s.count > 0).map((s) => s.station);
  return stations.length ? `Sent to ${stations.join(" + ")}` : null;
}

// The item grid's columns (Settings › Restaurant › Touch POS): 2, 3 or 4.
export const TABLET_COLUMNS = [2, 3, 4] as const;
export const tabletColumns = (value: number | null | undefined): number => (value === 2 || value === 3 || value === 4 ? value : 3);
