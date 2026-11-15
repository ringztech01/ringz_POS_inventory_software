import "server-only";
import { Prisma, type PaymentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CountAmount, RefundRow } from "../../../lib/reportPayments";
import type { ReportFilters, ReportPeriod } from "./filters";
import { closedIn, ORDER_SALE, orderScopeSql, type ReportResult } from "./scope";

// Restaurant Reports › Payments & tips (Step 6), added up in the database
// and put together by lib/reportPayments.ts. Read-only. The refunds list:
// the latest REFUND_LIST_LIMIT on screen, every one in the Excel export
// (refundPages: a page at a time, newest first).

export const REFUND_LIST_LIMIT = 500;

export type PaymentsData = {
  methods: (CountAmount & { method: PaymentType })[];
  tipsByWaiter: (CountAmount & { userId: string })[];
  tipsByMethod: (CountAmount & { method: PaymentType })[];
  names: Map<string, string>;
  refunds: RefundRow[];
  // More refunds than the list shows.
  refundsCut: boolean;
};

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => (value === null || value === undefined ? ZERO : new Prisma.Decimal(String(value)));
const int = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const personName = (u: { displayName: string | null; firstName: string; lastName: string }) => u.displayName || `${u.firstName} ${u.lastName}`.trim();

async function namesOf(ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, displayName: true, firstName: true, lastName: true } });
  return new Map(users.map((u) => [u.id, personName(u)]));
}

const refundsIn = (period: ReportPeriod, filters: ReportFilters) =>
  Prisma.sql`r.deletedAt IS NULL AND r.createdAt >= ${period.start} AND r.createdAt < ${period.end} AND ${orderScopeSql(filters)}`;

// Refunds newest first; `after`: the page after that one (keyset).
async function refundRows(period: ReportPeriod, filters: ReportFilters, page: { limit: number | null; after?: { at: Date; id: string } }): Promise<RefundRow[]> {
  const rows = await prisma.$queryRaw<{ id: string; reference: string; at: Date; sale: string; orderNumber: unknown; amount: unknown; methods: string | null; byId: string | null; restaurant: unknown; returned: unknown; status: string }[]>`
    SELECT r.id AS id, r.reference AS reference, r.createdAt AS at, s.reference AS sale, o.number AS orderNumber, r.grandTotal AS amount,
           (SELECT GROUP_CONCAT(DISTINCT rp.paymentType ORDER BY rp.paymentType) FROM SaleReturnPayment rp WHERE rp.saleReturnId = r.id AND rp.deletedAt IS NULL) AS methods,
           COALESCE(orf.createdById, r.createdById) AS byId,
           orf.id IS NOT NULL AS restaurant, orf.returnedToStock AS returned, r.status AS status
    FROM SaleReturn r JOIN ${ORDER_SALE} ON o.saleId = r.saleId
      LEFT JOIN OrderRefund orf ON orf.saleReturnId = r.id AND orf.deletedAt IS NULL
    WHERE ${refundsIn(period, filters)}
      ${page.after ? Prisma.sql`AND (r.createdAt < ${page.after.at} OR (r.createdAt = ${page.after.at} AND r.id < ${page.after.id}))` : Prisma.empty}
    ORDER BY r.createdAt DESC, r.id DESC
    ${page.limit === null ? Prisma.empty : Prisma.sql`LIMIT ${page.limit}`}`;
  const names = await namesOf(rows.map((r) => r.byId));
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    at: r.at,
    sale: r.sale,
    orderNumber: int(r.orderNumber),
    amount: dec(r.amount),
    methods: (r.methods ? r.methods.split(",") : []) as PaymentType[],
    by: r.byId ? (names.get(r.byId) ?? "Deleted user") : null,
    toStock: int(r.restaurant) === 1 ? int(r.returned) === 1 : r.status === "RECEIVED" || r.status === "COMPLETED",
  }));
}

export async function countRefunds(period: ReportPeriod, filters: ReportFilters): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: unknown }[]>`SELECT COUNT(*) AS n FROM SaleReturn r JOIN ${ORDER_SALE} ON o.saleId = r.saleId WHERE ${refundsIn(period, filters)}`;
  return int(row?.n);
}

// Every refund in the period, a page at a time, newest first.
export async function* refundPages(period: ReportPeriod, filters: ReportFilters, size = 5000): AsyncGenerator<RefundRow[]> {
  let after: { at: Date; id: string } | undefined;
  for (;;) {
    const page = await refundRows(period, filters, { limit: size, after });
    if (page.length) yield page;
    if (page.length < size) return;
    const last = page[page.length - 1];
    after = { at: last.at, id: last.id };
  }
}

// `limit`: the refunds list's length (null: all of them).
export async function getPaymentsReport(period: ReportPeriod, filters: ReportFilters, options: { limit?: number | null } = {}): Promise<ReportResult<PaymentsData>> {
  const limit = options.limit === undefined ? REFUND_LIST_LIMIT : options.limit;
  try {
    const [methods, tipsByWaiter, tipsByMethod, refunds] = await Promise.all([
      prisma.$queryRaw<{ method: PaymentType; count: unknown; amount: unknown }[]>`
        SELECT p.paymentType AS method, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS amount
        FROM SalePayment p JOIN ${ORDER_SALE} ON s.id = p.saleId
        WHERE p.deletedAt IS NULL AND ${orderScopeSql(filters)} AND ${closedIn(period)}
        GROUP BY p.paymentType`,
      prisma.$queryRaw<{ userId: string; count: unknown; amount: unknown }[]>`
        SELECT t.waiterId AS userId, COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS amount
        FROM OrderTip t JOIN ${ORDER_SALE} ON o.id = t.orderId
        WHERE t.deletedAt IS NULL AND ${orderScopeSql(filters)} AND ${closedIn(period)}
        GROUP BY t.waiterId`,
      prisma.$queryRaw<{ method: PaymentType; count: unknown; amount: unknown }[]>`
        SELECT t.paymentType AS method, COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS amount
        FROM OrderTip t JOIN ${ORDER_SALE} ON o.id = t.orderId
        WHERE t.deletedAt IS NULL AND ${orderScopeSql(filters)} AND ${closedIn(period)}
        GROUP BY t.paymentType`,
      refundRows(period, filters, { limit: limit === null ? null : limit + 1 }),
    ]);
    const names = await namesOf(tipsByWaiter.map((t) => t.userId));
    return {
      ok: true,
      data: {
        methods: methods.map((r) => ({ method: r.method, count: int(r.count), amount: dec(r.amount) })),
        tipsByWaiter: tipsByWaiter.map((r) => ({ userId: r.userId, count: int(r.count), amount: dec(r.amount) })),
        tipsByMethod: tipsByMethod.map((r) => ({ method: r.method, count: int(r.count), amount: dec(r.amount) })),
        names,
        refunds: limit === null ? refunds : refunds.slice(0, limit),
        refundsCut: limit !== null && refunds.length > limit,
      },
    };
  } catch (error) {
    console.error("[restaurant] reports: payments failed:", error);
    return { ok: false, error: "The payments report couldn't be loaded. Please try again." };
  }
}
