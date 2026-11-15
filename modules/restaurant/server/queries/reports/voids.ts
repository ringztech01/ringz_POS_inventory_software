import "server-only";
import { Prisma, type OrderDiscountType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import type { DiscountRow, VoidRow } from "../../../lib/reportVoids";
import type { ReportFilters, ReportPeriod } from "./filters";
import { closedIn, ORDER_SALE, orderScopeSql, type ReportResult } from "./scope";

// Restaurant Reports › Voids & discounts (Step 8). Read-only. The totals are
// added up over everything; the lists show the latest LIST_LIMIT.
//
// Voids: lines voided in the period on any order but a training or deleted
// one — the order's area, type and waiter, and the line's station narrow
// them (a void needn't have a payment, so not the device). Discounts: the
// period's settled bills, all the filters.

export const LIST_LIMIT = 500;

export type VoidsData = {
  voids: VoidRow[];
  discounts: DiscountRow[];
  totals: { voids: { count: number; value: Prisma.Decimal; approved: number }; discounts: { count: number; amount: Prisma.Decimal; approved: number } };
  limitPercent: Prisma.Decimal;
  cut: { voids: boolean; discounts: boolean };
};

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => (value === null || value === undefined ? ZERO : new Prisma.Decimal(String(value)));
const int = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

function voidScope(period: ReportPeriod, filters: ReportFilters): Prisma.Sql {
  return Prisma.sql`i.cancelledAt >= ${period.start} AND i.cancelledAt < ${period.end} AND i.deletedAt IS NULL AND o.deletedAt IS NULL AND o.training = 0
    ${filters.area ? Prisma.sql`AND EXISTS (SELECT 1 FROM \`Table\` ft WHERE ft.id = o.tableId AND ft.areaId = ${filters.area})` : Prisma.empty}
    ${filters.type ? Prisma.sql`AND o.type = ${filters.type}` : Prisma.empty}
    ${filters.waiter ? Prisma.sql`AND o.waiterId = ${filters.waiter}` : Prisma.empty}
    ${filters.station ? Prisma.sql`AND i.stationId = ${filters.station}` : Prisma.empty}`;
}

// The manager who approved a void (Part 6f: override.void on the line).
const VOID_APPROVER = Prisma.sql`(SELECT JSON_UNQUOTE(JSON_EXTRACT(a.meta, '$.approvedById')) FROM AuditLog a WHERE a.entityType = 'OrderItem' AND a.entityId = i.id AND a.action = 'override.void' ORDER BY a.createdAt DESC LIMIT 1)`;

type Page = { limit: number | null; after?: { at: Date; id: string } };
const keyset = (column: Prisma.Sql, idColumn: Prisma.Sql, page: Page) =>
  page.after ? Prisma.sql`AND (${column} < ${page.after.at} OR (${column} = ${page.after.at} AND ${idColumn} < ${page.after.id}))` : Prisma.empty;
const limitOf = (page: Page) => (page.limit === null ? Prisma.empty : Prisma.sql`LIMIT ${page.limit}`);

async function namesOf(ids: readonly (string | null)[]): Promise<(id: string | null) => string | null> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const users = wanted.length ? await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, displayName: true, firstName: true, lastName: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.displayName || `${u.firstName} ${u.lastName}`.trim()]));
  return (id) => (id ? (names.get(id) ?? "Deleted user") : null);
}

// Voids newest first; `after`: the page after that one (keyset).
async function voidRows(period: ReportPeriod, filters: ReportFilters, page: Page): Promise<VoidRow[]> {
  const rows = await prisma.$queryRaw<{ id: string; at: Date; orderId: string; orderNumber: unknown; tableName: string | null; item: string; quantity: unknown; value: unknown; waiterId: string | null; voidedById: string | null; reason: string | null; approverId: string | null }[]>`
    SELECT i.id AS id, i.cancelledAt AS at, o.id AS orderId, o.number AS orderNumber, t.name AS tableName, p.name AS item, i.quantity AS quantity,
           i.quantity * i.unitPrice AS value, o.waiterId AS waiterId, i.cancelledById AS voidedById, i.cancelReason AS reason, ${VOID_APPROVER} AS approverId
    FROM OrderItem i JOIN \`Order\` o ON o.id = i.orderId JOIN Product p ON p.id = i.productId LEFT JOIN \`Table\` t ON t.id = o.tableId
    WHERE ${voidScope(period, filters)} ${keyset(Prisma.sql`i.cancelledAt`, Prisma.sql`i.id`, page)}
    ORDER BY i.cancelledAt DESC, i.id DESC
    ${limitOf(page)}`;
  const name = await namesOf(rows.flatMap((r) => [r.waiterId, r.voidedById, r.approverId]));
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    orderId: r.orderId,
    orderNumber: int(r.orderNumber),
    table: r.tableName,
    item: r.item,
    quantity: int(r.quantity),
    value: dec(r.value),
    waiter: name(r.waiterId),
    voidedBy: name(r.voidedById),
    voidedById: r.voidedById,
    reason: r.reason,
    approvedBy: name(r.approverId),
  }));
}

// Discounted bills, newest first.
async function discountRows(period: ReportPeriod, filters: ReportFilters, page: Page): Promise<DiscountRow[]> {
  const rows = await prisma.$queryRaw<{ orderId: string; orderNumber: unknown; at: Date; type: OrderDiscountType; value: unknown; amount: unknown; items: unknown; reason: string | null; appliedById: string | null; approverId: string | null }[]>`
    SELECT o.id AS orderId, o.number AS orderNumber, o.closedAt AS at, o.discountType AS type, o.discountValue AS value, s.discount AS amount,
           s.grandTotal + s.discount - s.shipping AS items, o.discountReason AS reason, o.discountById AS appliedById, o.discountApprovedById AS approverId
    FROM ${ORDER_SALE}
    WHERE o.discountType IS NOT NULL AND ${orderScopeSql(filters)} AND ${closedIn(period)} ${keyset(Prisma.sql`o.closedAt`, Prisma.sql`o.id`, page)}
    ORDER BY o.closedAt DESC, o.id DESC
    ${limitOf(page)}`;
  const name = await namesOf(rows.flatMap((r) => [r.appliedById, r.approverId]));
  return rows.map((r) => ({
    orderId: r.orderId,
    orderNumber: int(r.orderNumber),
    at: r.at,
    type: r.type,
    value: dec(r.value),
    amount: dec(r.amount),
    items: dec(r.items),
    reason: r.reason,
    appliedBy: name(r.appliedById),
    appliedById: r.appliedById,
    approvedBy: name(r.approverId),
  }));
}

async function* pages<T extends { at: Date }>(load: (page: Page) => Promise<T[]>, idOf: (row: T) => string, size: number): AsyncGenerator<T[]> {
  let after: Page["after"];
  for (;;) {
    const page = await load({ limit: size, after });
    if (page.length) yield page;
    if (page.length < size) return;
    const last = page[page.length - 1];
    after = { at: last.at, id: idOf(last) };
  }
}

// Every void / discounted bill in the period, a page at a time, newest first (the Excel export).
export const voidPages = (period: ReportPeriod, filters: ReportFilters, size = 5000) => pages((p) => voidRows(period, filters, p), (r) => r.id, size);
export const discountPages = (period: ReportPeriod, filters: ReportFilters, size = 5000) => pages((p) => discountRows(period, filters, p), (r) => r.orderId, size);

// `limit`: the lists' length (null: all of them).
export async function getVoidsReport(period: ReportPeriod, filters: ReportFilters, options: { limit?: number | null } = {}): Promise<ReportResult<VoidsData>> {
  const limit = options.limit === undefined ? LIST_LIMIT : options.limit;
  const page: Page = { limit: limit === null ? null : limit + 1 };
  try {
    const [voids, voidSum, discounts, discountSum, setting] = await Promise.all([
      voidRows(period, filters, page),
      prisma.$queryRaw<{ count: unknown; value: unknown; approved: unknown }[]>`
        SELECT COUNT(*) AS count, COALESCE(SUM(i.quantity * i.unitPrice), 0) AS value, COALESCE(SUM(${VOID_APPROVER} IS NOT NULL), 0) AS approved
        FROM OrderItem i JOIN \`Order\` o ON o.id = i.orderId
        WHERE ${voidScope(period, filters)}`,
      discountRows(period, filters, page),
      prisma.$queryRaw<{ count: unknown; amount: unknown; approved: unknown }[]>`
        SELECT COUNT(*) AS count, COALESCE(SUM(s.discount), 0) AS amount, COALESCE(SUM(o.discountApprovedById IS NOT NULL), 0) AS approved
        FROM ${ORDER_SALE}
        WHERE o.discountType IS NOT NULL AND ${orderScopeSql(filters)} AND ${closedIn(period)}`,
      prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantDiscountLimitPercent: true } }),
    ]);
    const cut = (rows: unknown[]) => limit !== null && rows.length > limit;
    return {
      ok: true,
      data: {
        voids: limit === null ? voids : voids.slice(0, limit),
        discounts: limit === null ? discounts : discounts.slice(0, limit),
        totals: {
          voids: { count: int(voidSum[0]?.count), value: dec(voidSum[0]?.value), approved: int(voidSum[0]?.approved) },
          discounts: { count: int(discountSum[0]?.count), amount: dec(discountSum[0]?.amount), approved: int(discountSum[0]?.approved) },
        },
        limitPercent: setting?.restaurantDiscountLimitPercent ?? new Prisma.Decimal(10),
        cut: { voids: cut(voids), discounts: cut(discounts) },
      },
    };
  } catch (error) {
    console.error("[restaurant] reports: voids & discounts failed:", error);
    return { ok: false, error: "The voids & discounts report couldn't be loaded. Please try again." };
  }
}
