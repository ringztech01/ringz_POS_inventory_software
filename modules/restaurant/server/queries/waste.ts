import "server-only";
import type { Prisma, ProductType, WasteReason, WasteStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DateRange } from "@/lib/dateRanges";
import { orderRef } from "../../lib/format";
import { appDayBounds } from "../../lib/time";
import { summarizeWaste, type WasteFilter } from "../../lib/waste";

// Food › Waste: the entries in the period with their filters, the period's
// summary, and the pickers' options. The list shows the waste as logged; a
// VOID entry (the undo of one) isn't a row of its own — it shows on the
// entry it voided (who, when, why).

const LIVE = { deletedAt: null } as const;
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

export type WasteLineRow = { productId: string; name: string; qty: string; unit: string; unitCost: string; lineCost: string };

export type WasteRow = {
  id: string;
  // ISO.
  createdAt: string;
  item: { id: string; name: string; code: string };
  qty: string;
  unit: string;
  reason: WasteReason;
  note: string | null;
  // As logged (2dp).
  cost: string;
  loggedBy: string;
  approvedBy: string | null;
  status: WasteStatus;
  // Void sends it back (a stale screen is refused).
  version: number;
  warehouse: string;
  // Logged from an order line (a Remake, returned by the guest).
  order: { ref: string; item: string } | null;
  voided: { at: string; by: string; reason: string | null } | null;
  // What came out of stock.
  lines: WasteLineRow[];
};

export type WasteSummary = { total: string; count: number; topReason: WasteReason | null; topReasonCost: string | null };

export type WasteItemOption = { id: string; name: string; code: string; type: "MENU_ITEM" | "INGREDIENT"; unit: string };

const period = (range: DateRange) => ({ gte: appDayBounds(range.from).start, lt: appDayBounds(range.to).end });

// The rows the filters ask for (ACTIVE entries and voided ones — never the
// VOID entries themselves).
export function wasteWhere(filter: WasteFilter): Prisma.WasteEntryWhereInput {
  return {
    ...LIVE,
    voidOfId: null,
    createdAt: period(filter.range),
    ...(filter.reason ? { reason: filter.reason } : {}),
    ...(filter.userId ? { loggedById: filter.userId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.q ? { product: { OR: [{ name: { contains: filter.q } }, { code: { contains: filter.q } }] } } : {}),
  };
}

const userName = { select: { firstName: true, lastName: true } } as const;

// Newest first, a page at a time.
export async function getWasteList(filter: WasteFilter, page: number, perPage: number): Promise<{ rows: WasteRow[]; total: number }> {
  const where = wasteWhere(filter);
  const [entries, total] = await Promise.all([
    prisma.wasteEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        createdAt: true,
        qty: true,
        unit: true,
        reason: true,
        note: true,
        costSnapshot: true,
        status: true,
        version: true,
        product: { select: { id: true, name: true, code: true } },
        warehouse: { select: { name: true } },
        loggedBy: userName,
        approvedBy: userName,
        orderItem: { select: { product: { select: { name: true } }, order: { select: { number: true } } } },
        voidedBy: { select: { createdAt: true, voidReason: true, loggedBy: userName } },
        lines: {
          orderBy: { productId: "asc" },
          select: { productId: true, qty: true, unitCost: true, lineCost: true, product: { select: { name: true, unit: { select: { name: true } } } } },
        },
      },
    }),
    prisma.wasteEntry.count({ where }),
  ]);
  return {
    total,
    rows: entries.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      item: e.product,
      qty: e.qty.toString(),
      unit: e.unit,
      reason: e.reason,
      note: e.note,
      cost: e.costSnapshot.toFixed(2),
      loggedBy: fullName(e.loggedBy),
      approvedBy: e.approvedBy ? fullName(e.approvedBy) : null,
      status: e.status,
      version: e.version,
      warehouse: e.warehouse.name,
      order: e.orderItem ? { ref: orderRef(e.orderItem.order.number), item: e.orderItem.product.name } : null,
      voided: e.voidedBy ? { at: e.voidedBy.createdAt.toISOString(), by: fullName(e.voidedBy.loggedBy), reason: e.voidedBy.voidReason } : null,
      lines: e.lines.map((l) => ({
        productId: l.productId,
        name: l.product.name,
        qty: l.qty.toString(),
        unit: l.product.unit.name,
        unitCost: l.unitCost.toFixed(2),
        lineCost: l.lineCost.toFixed(2),
      })),
    })),
  };
}

// The summary strip: the period's waste that stands (voided entries left
// out), whatever the other filters — its cost, the entries, the top reason.
export async function getWasteSummary(range: DateRange): Promise<WasteSummary> {
  const groups = await prisma.wasteEntry.groupBy({
    by: ["reason"],
    where: { ...LIVE, voidOfId: null, status: "ACTIVE", createdAt: period(range) },
    _sum: { costSnapshot: true },
    _count: { _all: true },
  });
  const byReason = groups.map((g) => ({ reason: g.reason, cost: g._sum.costSnapshot?.toFixed(2) ?? "0.00", count: g._count._all }));
  const summary = summarizeWaste(byReason);
  const top = byReason.find((r) => r.reason === summary.topReason);
  return { total: summary.total.toFixed(2), count: summary.count, topReason: summary.topReason, topReasonCost: top?.cost ?? null };
}

// The Logged by filter: everyone who has logged waste.
export async function getWasteUsers(): Promise<{ id: string; name: string }[]> {
  const users = await prisma.user.findMany({
    where: { wasteLogged: { some: { ...LIVE, voidOfId: null } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });
  return users.map((u) => ({ id: u.id, name: fullName(u) }));
}

// The Log waste item picker: every menu item and ingredient, with its unit.
export async function getWasteItemOptions(): Promise<WasteItemOption[]> {
  const products = await prisma.product.findMany({
    where: { ...LIVE, productType: { in: ["MENU_ITEM", "INGREDIENT"] satisfies ProductType[] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, productType: true, unit: { select: { name: true } } },
  });
  return products.map((p) => ({ id: p.id, name: p.name, code: p.code, type: p.productType as WasteItemOption["type"], unit: p.unit.name }));
}
