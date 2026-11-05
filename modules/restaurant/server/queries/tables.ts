import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { reservationHoldRange, tableStatus, type TableStatus, type TableStatusRules } from "../../lib/tableStatus";
import { getTableStatusRules } from "../rules";

// What tableStatus needs from a table: its order holding the table (the DB's
// activeTableId marks it) and the Booked reservations that could be due now.
export function tableStateSelect(now: Date, rules: TableStatusRules) {
  const { from, to } = reservationHoldRange(now, rules);
  return {
    deletedAt: true,
    needsCleaning: true,
    orders: {
      where: { activeTableId: { not: null } },
      select: { id: true, status: true, deletedAt: true },
    },
    reservations: {
      where: { status: "BOOKED", deletedAt: null, startsAt: { gte: from, lte: to } },
      select: { id: true, status: true, startsAt: true, deletedAt: true, guestName: true, partySize: true },
    },
  } satisfies Prisma.TableSelect;
}

// Floor order: area tab order, then table names compared as people read
// them (T2 before T10).
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
type Sortable = { name: string; area: { sortOrder: number; createdAt: Date } };
export function byFloorOrder(a: Sortable, b: Sortable) {
  return (
    a.area.sortOrder - b.area.sortOrder ||
    a.area.createdAt.getTime() - b.area.createdAt.getTime() ||
    names.compare(a.name, b.name)
  );
}

const activeTables = (filter: { areaId?: string; q?: string }): Prisma.TableWhereInput => ({
  deletedAt: null,
  area: { deletedAt: null },
  ...(filter.areaId ? { areaId: filter.areaId } : {}),
  ...(filter.q ? { name: { contains: filter.q } } : {}),
});

export type TableRow = {
  id: string;
  name: string;
  seats: number;
  areaId: string;
  areaName: string;
  status: TableStatus;
  // Delete is blocked while true.
  hasOpenOrder: boolean;
};

export type TableListParams = { q?: string; areaId?: string; page: number; perPage: number };

// The Tables list: active tables in active areas, filtered and paged. The
// filtered set is ids and names only (sorted naturally, then sliced); the
// page's rows then load their status data.
export async function getTableList({ q, areaId, page, perPage }: TableListParams) {
  const matching = await prisma.table.findMany({
    where: activeTables({ q, areaId }),
    select: { id: true, name: true, area: { select: { sortOrder: true, createdAt: true } } },
  });
  const pageIds = matching
    .sort(byFloorOrder)
    .slice((page - 1) * perPage, page * perPage)
    .map((table) => table.id);

  const now = new Date();
  const rules = await getTableStatusRules();
  const loaded = await prisma.table.findMany({
    where: { id: { in: pageIds } },
    select: { id: true, name: true, seats: true, areaId: true, area: { select: { name: true } }, ...tableStateSelect(now, rules) },
  });
  const byId = new Map(loaded.map((table) => [table.id, table]));

  const rows: TableRow[] = pageIds.flatMap((id) => {
    const table = byId.get(id);
    const state = table && tableStatus(table, rules, now);
    if (!table || !state) return [];
    return [
      {
        id: table.id,
        name: table.name,
        seats: table.seats,
        areaId: table.areaId,
        areaName: table.area.name,
        status: state.status,
        hasOpenOrder: state.order !== null,
      },
    ];
  });

  return { rows, total: matching.length };
}

export type QrSheetTable = { id: string; name: string; areaName: string; qrToken: string };

// Every active table (optionally one area's), in floor order, for the QR sheet.
export async function getQrSheetTables(areaId?: string): Promise<QrSheetTable[]> {
  const tables = await prisma.table.findMany({
    where: activeTables({ areaId }),
    select: { id: true, name: true, qrToken: true, area: { select: { name: true, sortOrder: true, createdAt: true } } },
  });
  return tables.sort(byFloorOrder).map((t) => ({ id: t.id, name: t.name, areaName: t.area.name, qrToken: t.qrToken }));
}

// One table for its QR download; null if it (or its area) is deleted.
export async function getTableQr(id: string) {
  return prisma.table.findFirst({
    where: { id, deletedAt: null, area: { deletedAt: null } },
    select: { name: true, qrToken: true, area: { select: { name: true } } },
  });
}

// The table a scanned code belongs to. A regenerated (old) token, a deleted
// table or a deleted area all give null — the old link stops working.
export async function findTableByQrToken(qrToken: string) {
  if (!qrToken) return null;
  return prisma.table.findFirst({
    where: { qrToken, deletedAt: null, area: { deletedAt: null } },
    select: { id: true, name: true, areaId: true, area: { select: { name: true, warehouseId: true } } },
  });
}
