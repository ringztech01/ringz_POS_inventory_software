import "server-only";
import { Prisma, type PurchaseStatus, type SaleReturnStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dateRangeWhere, purchaseListWhere } from "@/app/(dashboard)/purchases/queries";
import { purchaseReturnListWhere } from "@/app/(dashboard)/purchases/returns/queries";
import { SALE_LIST_SELECT, saleListWhere } from "@/app/(dashboard)/sales/queries";
import { saleReturnListWhere } from "@/app/(dashboard)/sales/returns/queries";
import { expenseListWhere } from "@/app/(dashboard)/expenses/queries";
import {
  eachDay,
  lastNDaysRange,
  thisMonthRange,
  thisYearRange,
  todayRange,
  type DateRange,
} from "@/lib/dateRanges";

// The dashboard's queries — read-only, one function per section. Every sum
// is aggregated in the database (aggregate / groupBy / $queryRaw), never by
// loading rows into JS. Money leaves here as strings (2dp) so it can go
// straight to client components.
//
// Filters are the list pages' own (saleListWhere, purchaseListWhere, …:
// active rows, date range), so the dashboard and a list filtered the same
// way can't disagree. On top of that, financial totals apply ONE status rule:
//
//   STATUS RULE (what counts as money moved)
//     Sales, Purchases ........ RECEIVED
//     Purchase Returns ........ RECEIVED
//     Sale Returns ............ RECEIVED or COMPLETED (their own enum)
//
// i.e. the same statuses that move stock (lib/purchase-stock.ts).

const COUNTED_SALE: { status: PurchaseStatus } = { status: "RECEIVED" };
const COUNTED_PURCHASE: { status: PurchaseStatus } = { status: "RECEIVED" };
const COUNTED_PURCHASE_RETURN: { status: PurchaseStatus } = { status: "RECEIVED" };
const COUNTED_SALE_RETURN: { status: { in: SaleReturnStatus[] } } = { status: { in: ["RECEIVED", "COMPLETED"] } };

const money = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(2);

// ---------------------------------------------------------------- Step 1: KPI tiles

export type DashboardKpis = {
  sales: string;
  purchases: string;
  saleReturns: string;
  purchaseReturns: string;
  todaySales: string;
  // Money actually collected today (SalePayment), not sale totals.
  todayReceived: string;
  todayPurchases: string;
  todayExpenses: string;
};

export async function getDashboardKpis(now: Date = new Date()): Promise<DashboardKpis> {
  const today = todayRange(now);
  const [sales, purchases, saleReturns, purchaseReturns, todaySales, todayReceived, todayPurchases, todayExpenses] =
    await Promise.all([
      prisma.sale.aggregate({ where: { ...saleListWhere({}), ...COUNTED_SALE }, _sum: { grandTotal: true } }),
      prisma.purchase.aggregate({ where: { ...purchaseListWhere({}), ...COUNTED_PURCHASE }, _sum: { grandTotal: true } }),
      prisma.saleReturn.aggregate({
        where: { ...saleReturnListWhere({}), ...COUNTED_SALE_RETURN },
        _sum: { grandTotal: true },
      }),
      prisma.purchaseReturn.aggregate({
        where: { ...purchaseReturnListWhere({}), ...COUNTED_PURCHASE_RETURN },
        _sum: { grandTotal: true },
      }),
      prisma.sale.aggregate({
        where: { ...saleListWhere({ from: today.from, to: today.to }), ...COUNTED_SALE },
        _sum: { grandTotal: true },
      }),
      // Payments dated today on live sales (any status — it's cash in hand).
      prisma.salePayment.aggregate({
        where: { deletedAt: null, sale: { deletedAt: null }, ...dateRangeWhere(today.from, today.to) },
        _sum: { amount: true },
      }),
      prisma.purchase.aggregate({
        where: { ...purchaseListWhere({ from: today.from, to: today.to }), ...COUNTED_PURCHASE },
        _sum: { grandTotal: true },
      }),
      prisma.expense.aggregate({
        where: { ...expenseListWhere({}), ...dateRangeWhere(today.from, today.to) },
        _sum: { amount: true },
      }),
    ]);

  return {
    sales: money(sales._sum.grandTotal),
    purchases: money(purchases._sum.grandTotal),
    saleReturns: money(saleReturns._sum.grandTotal),
    purchaseReturns: money(purchaseReturns._sum.grandTotal),
    todaySales: money(todaySales._sum.grandTotal),
    todayReceived: money(todayReceived._sum.amount),
    todayPurchases: money(todayPurchases._sum.grandTotal),
    todayExpenses: money(todayExpenses._sum.amount),
  };
}

// ---------------------------------------------------------------- Step 2: weekly chart

export type WeeklySalesPurchases = {
  // 7 days, oldest first, always all 7 ("YYYY-MM-DD").
  labels: string[];
  sales: string[];
  purchases: string[];
};

type DayTotal = { day: string; total: Prisma.Decimal | null };

// Per-day Received grandTotal over the last 7 days (today included), grouped
// by day in the DB. Dates are date-only (UTC midnight), so the stored date
// IS the calendar day. Missing days are filled with 0 here.
export async function getWeeklySalesPurchases(now: Date = new Date()): Promise<WeeklySalesPurchases> {
  const range = lastNDaysRange(7, now);
  const from = new Date(`${range.from}T00:00:00.000Z`);
  const toExclusive = new Date(Date.parse(`${range.to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000);

  const [saleDays, purchaseDays] = await Promise.all([
    prisma.$queryRaw<DayTotal[]>`
      SELECT DATE_FORMAT(\`date\`, '%Y-%m-%d') AS day, SUM(\`grandTotal\`) AS total
      FROM \`Sale\`
      WHERE \`deletedAt\` IS NULL AND \`status\` = 'RECEIVED' AND \`date\` >= ${from} AND \`date\` < ${toExclusive}
      GROUP BY day`,
    prisma.$queryRaw<DayTotal[]>`
      SELECT DATE_FORMAT(\`date\`, '%Y-%m-%d') AS day, SUM(\`grandTotal\`) AS total
      FROM \`Purchase\`
      WHERE \`deletedAt\` IS NULL AND \`status\` = 'RECEIVED' AND \`date\` >= ${from} AND \`date\` < ${toExclusive}
      GROUP BY day`,
  ]);

  const labels = eachDay(range);
  const byDay = (rows: DayTotal[]) => new Map(rows.map((row) => [row.day, money(row.total)]));
  const sales = byDay(saleDays);
  const purchases = byDay(purchaseDays);
  return {
    labels,
    sales: labels.map((day) => sales.get(day) ?? "0.00"),
    purchases: labels.map((day) => purchases.get(day) ?? "0.00"),
  };
}

// ---------------------------------------------------------------- Step 3: top products

export type TopProduct = { productId: string; code: string; name: string; quantity: number; grandTotal: string };

// Top 5 products by quantity sold in a window: SaleItem grouped by product,
// only lines of Received, live sales dated in the window, on live products.
// "grandTotal" is the sum of the lines' subtotals (before order-level tax,
// discount and shipping, which belong to the sale, not a product).
export async function getTopSellingProducts(range: DateRange, take = 5): Promise<TopProduct[]> {
  const groups = await prisma.saleItem.groupBy({
    by: ["productId"],
    where: {
      sale: { ...saleListWhere({ from: range.from, to: range.to }), ...COUNTED_SALE },
      product: { deletedAt: null },
    },
    _sum: { quantity: true, subtotal: true },
    orderBy: { _sum: { quantity: "desc" } },
    take,
  });
  if (groups.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: groups.map((g) => g.productId) } },
    select: { id: true, code: true, name: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return groups.map((g) => ({
    productId: g.productId,
    code: byId.get(g.productId)?.code ?? "",
    name: byId.get(g.productId)?.name ?? "Unknown product",
    quantity: g._sum.quantity ?? 0,
    grandTotal: money(g._sum.subtotal),
  }));
}

export const getTopSellingProductsThisYear = (now: Date = new Date()) => getTopSellingProducts(thisYearRange(now));
export const getTopSellingProductsThisMonth = (now: Date = new Date()) => getTopSellingProducts(thisMonthRange(now));

// ---------------------------------------------------------------- Step 4: top customers

export type TopCustomer = { customerId: string; name: string; grandTotal: string };

// Top 5 customers by Received sales total this month (live sales, live
// customers). The walk-in "direct-customer" counts like any other.
export async function getTopCustomers(now: Date = new Date(), take = 5): Promise<TopCustomer[]> {
  const month = thisMonthRange(now);
  const groups = await prisma.sale.groupBy({
    by: ["customerId"],
    where: {
      ...saleListWhere({ from: month.from, to: month.to }),
      ...COUNTED_SALE,
      customer: { deletedAt: null },
    },
    _sum: { grandTotal: true },
    orderBy: { _sum: { grandTotal: "desc" } },
    take,
  });
  if (groups.length === 0) return [];

  const customers = await prisma.customer.findMany({
    where: { id: { in: groups.map((g) => g.customerId) } },
    select: { id: true, name: true },
  });
  const byId = new Map(customers.map((c) => [c.id, c.name]));
  return groups.map((g) => ({
    customerId: g.customerId,
    name: byId.get(g.customerId) ?? "Unknown customer",
    grandTotal: money(g._sum.grandTotal),
  }));
}

// ---------------------------------------------------------------- Step 5: recent sales

export type RecentSale = {
  id: string;
  reference: string;
  customerName: string;
  status: PurchaseStatus;
  grandTotal: string;
  paid: string;
  due: string;
  paymentStatus: Prisma.SaleGetPayload<{ select: { paymentStatus: true } }>["paymentStatus"];
};

// The 5 most recent live sales, any status — the Sales list's own select and
// order. paid / due / paymentStatus are the stored columns the Sales list
// shows, written by computePaymentState (lib/payments.ts) on every payment
// change; never recomputed here.
export async function getRecentSales(take = 5): Promise<RecentSale[]> {
  const rows = await prisma.sale.findMany({
    where: saleListWhere({}),
    select: SALE_LIST_SELECT,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
  });
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    customerName: row.customer.name,
    status: row.status,
    grandTotal: money(row.grandTotal),
    paid: money(row.paid),
    due: money(row.due),
    paymentStatus: row.paymentStatus,
  }));
}

// ---------------------------------------------------------------- Step 6: stock alerts

export type StockAlertRow = {
  productId: string;
  code: string;
  name: string;
  unitName: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  stockAlert: number;
};

type StockAlertRaw = Omit<StockAlertRow, "quantity" | "stockAlert"> & { quantity: number | bigint; stockAlert: number | bigint };

// One row per product × warehouse whose stock is at or below the product's
// alert level (a product can be low in one warehouse and fine in another).
// Products without an alert level, and deleted products or warehouses, are
// skipped. Comparing two columns needs SQL ($queryRaw). Lowest stock first;
// `total` is the full count for the "N items below alert" header.
export async function getStockAlerts(limit = 10): Promise<{ rows: StockAlertRow[]; total: number }> {
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<StockAlertRaw[]>`
      SELECT p.\`id\` AS productId, p.\`code\` AS code, p.\`name\` AS name, u.\`name\` AS unitName,
             w.\`id\` AS warehouseId, w.\`name\` AS warehouseName, ps.\`quantity\` AS quantity, p.\`stockAlert\` AS stockAlert
      FROM \`ProductStock\` ps
      JOIN \`Product\` p ON p.\`id\` = ps.\`productId\`
      JOIN \`Warehouse\` w ON w.\`id\` = ps.\`warehouseId\`
      JOIN \`Unit\` u ON u.\`id\` = p.\`unitId\`
      WHERE p.\`deletedAt\` IS NULL AND w.\`deletedAt\` IS NULL
        AND p.\`stockAlert\` IS NOT NULL AND ps.\`quantity\` <= p.\`stockAlert\`
      ORDER BY ps.\`quantity\` ASC, p.\`name\` ASC, w.\`name\` ASC
      LIMIT ${limit}`,
    prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM \`ProductStock\` ps
      JOIN \`Product\` p ON p.\`id\` = ps.\`productId\`
      JOIN \`Warehouse\` w ON w.\`id\` = ps.\`warehouseId\`
      WHERE p.\`deletedAt\` IS NULL AND w.\`deletedAt\` IS NULL
        AND p.\`stockAlert\` IS NOT NULL AND ps.\`quantity\` <= p.\`stockAlert\``,
  ]);

  return {
    rows: rows.map((row) => ({ ...row, quantity: Number(row.quantity), stockAlert: Number(row.stockAlert) })),
    total: Number(count[0]?.total ?? 0),
  };
}
