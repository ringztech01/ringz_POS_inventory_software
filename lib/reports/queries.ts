import "server-only";
import { prisma } from "@/lib/db";
import { getActiveWarehouses, getPurchaseList, purchaseListWhere } from "@/app/(dashboard)/purchases/queries";
import { getPurchaseReturnList, purchaseReturnListWhere } from "@/app/(dashboard)/purchases/returns/queries";
import { getSaleList, saleListWhere } from "@/app/(dashboard)/sales/queries";
import { getSaleReturnList, saleReturnListWhere } from "@/app/(dashboard)/sales/returns/queries";
import { getExpenseList } from "@/app/(dashboard)/expenses/queries";
import { productListWhere } from "@/app/(dashboard)/products/queries";
import type { ReportFilters } from "./params";

// Report queries — read-only. Each report is the matching LIST PAGE's own
// helper (getSaleList, getPurchaseReturnList, …: same filters, same columns,
// same stored paid/due/payment status), so a report and its list page can't
// disagree for the same filters. Nothing here re-derives a total.

// The warehouse filter's options (active warehouses), and the selected one if
// the URL's id is one of them (otherwise "All Warehouse").
export async function getReportWarehouses(warehouseId?: string) {
  const warehouses = await getActiveWarehouses();
  return { warehouses, selected: warehouses.find((w) => w.id === warehouseId) ?? null };
}

// ------------------------------------------------------- Warehouse Reports

export type WarehouseReportCounts = { sales: number; purchases: number; saleReturns: number; purchaseReturns: number };

// The 4 tiles: how many live documents of each kind the warehouse (or all
// warehouses) has — the same rows each list page counts for that filter, any
// status (a count of documents, not money).
export async function getWarehouseReportCounts(warehouseId?: string): Promise<WarehouseReportCounts> {
  const [sales, purchases, saleReturns, purchaseReturns] = await Promise.all([
    prisma.sale.count({ where: saleListWhere({ warehouseId }) }),
    prisma.purchase.count({ where: purchaseListWhere({ warehouseId }) }),
    prisma.saleReturn.count({ where: saleReturnListWhere({ warehouseId }) }),
    prisma.purchaseReturn.count({ where: purchaseReturnListWhere({ warehouseId }) }),
  ]);
  return { sales, purchases, saleReturns, purchaseReturns };
}

export const WAREHOUSE_REPORT_TABS = [
  { key: "sales", label: "Sales" },
  { key: "sale-returns", label: "Sales Returns" },
  { key: "purchase-returns", label: "Purchases Returns" },
  { key: "expenses", label: "Expenses" },
] as const;

export type WarehouseReportTab = (typeof WAREHOUSE_REPORT_TABS)[number]["key"];

export const parseWarehouseReportTab = (value?: string): WarehouseReportTab =>
  WAREHOUSE_REPORT_TABS.some((tab) => tab.key === value) ? (value as WarehouseReportTab) : "sales";

// The sub-tab's table — its list page's helper, filtered by the selected
// warehouse plus the URL's search, date range and page.
export async function getWarehouseReportTable(tab: WarehouseReportTab, filters: ReportFilters) {
  const params = {
    q: filters.q,
    from: filters.from,
    to: filters.to,
    warehouseId: filters.warehouseId,
    page: filters.page,
    perPage: filters.perPage,
  };
  switch (tab) {
    case "sales": {
      const { sales, total } = await getSaleList(params);
      return { kind: "sales" as const, rows: sales, total };
    }
    case "sale-returns": {
      const { saleReturns, total } = await getSaleReturnList(params);
      return { kind: "sale-returns" as const, rows: saleReturns, total };
    }
    case "purchase-returns": {
      const { returns, total } = await getPurchaseReturnList(params);
      return { kind: "purchase-returns" as const, rows: returns, total };
    }
    case "expenses": {
      const { expenses, total } = await getExpenseList(params);
      return { kind: "expenses" as const, rows: expenses, total };
    }
  }
}

// ------------------------------------------------------------ Sale Reports

// The Sales list's own query for the URL's search, date range, warehouse and
// page — the same rows, total and stored paid / payment status.
export async function getSaleReport(filters: ReportFilters) {
  const { sales, total } = await getSaleList({
    q: filters.q,
    from: filters.from,
    to: filters.to,
    warehouseId: filters.warehouseId,
    page: filters.page,
    perPage: filters.perPage,
  });
  return { rows: sales, total };
}

// -------------------------------------------------------- Purchase Reports

// The Purchases list's own query for the URL's search, date range, warehouse
// and page — the same rows and total.
export async function getPurchaseReport(filters: ReportFilters) {
  const { purchases, total } = await getPurchaseList({
    q: filters.q,
    from: filters.from,
    to: filters.to,
    warehouseId: filters.warehouseId,
    page: filters.page,
    perPage: filters.perPage,
  });
  return { rows: purchases, total };
}

// ----------------------------------------------------------- Stock Reports

export type StockReportRow = {
  id: string;
  code: string;
  name: string;
  categoryName: string;
  unitName: string;
  // Decimal strings (Prisma's toString: "500", "1250.5"); cost is null until
  // the product has one.
  cost: string | null;
  price: string;
  stock: number;
};

// The Products list's products (same search, same order), each with its
// current stock: the ProductStock quantity in the selected warehouse, or the
// sum over every warehouse for All Warehouse (as the list's "In stock") —
// summed in the database. A product with no stock row there shows 0.
export async function getStockReport(filters: ReportFilters): Promise<{ rows: StockReportRow[]; total: number }> {
  const where = productListWhere({ q: filters.q });

  const [total, products] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        cost: true,
        price: true,
        category: { select: { name: true } },
        unit: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.perPage,
      take: filters.perPage,
    }),
  ]);

  const sums = await prisma.productStock.groupBy({
    by: ["productId"],
    where: {
      productId: { in: products.map((product) => product.id) },
      ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
    },
    _sum: { quantity: true },
  });
  const stockByProduct = new Map(sums.map((row) => [row.productId, row._sum.quantity ?? 0]));

  return {
    rows: products.map((product) => ({
      id: product.id,
      code: product.code,
      name: product.name,
      categoryName: product.category.name,
      unitName: product.unit.name,
      cost: product.cost?.toString() ?? null,
      price: product.price.toString(),
      stock: stockByProduct.get(product.id) ?? 0,
    })),
    total,
  };
}

// The product a stock report is for (live products only).
export async function getStockReportProduct(productId: string) {
  return prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, code: true, name: true } });
}
