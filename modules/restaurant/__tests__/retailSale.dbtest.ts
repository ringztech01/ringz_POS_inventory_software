// Retail's one sale-saving path (app/(dashboard)/sales/save-sale.ts →
// saveNewSale, used by the Sales form and the POS till) pinned down before
// and after Part 6's refactor of it (saveSaleInTx): the same input saves the
// same sale, payment and stock. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/retailSale.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { saveNewSale } from "@/app/(dashboard)/sales/save-sale";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let warehouseId = "";
let customerId = "";
const product: Record<"a" | "b", string> = { a: "", b: "" };
const stockOf = async (productId: string) => (await prisma.productStock.findFirstOrThrow({ where: { productId, warehouseId } })).quantity;

const input = (extra: Record<string, unknown> = {}) => ({
  date: "2026-11-01",
  status: "RECEIVED",
  warehouseId,
  customerId,
  orderTax: "5",
  discount: "3.00",
  shipping: "2.50",
  notes: "Retail check",
  paidAmount: "20.00",
  paymentType: "CARD",
  items: [
    { productId: product.a, quantity: 2, unitCost: "18.00", discountType: "FIXED", discount: "1", taxType: "EXCLUSIVE", taxRate: "7.5", purchaseUnit: "Pic" },
    { productId: product.b, quantity: 1, unitCost: "", discountType: "PERCENTAGE", discount: "10", taxType: "INCLUSIVE", taxRate: "7.5", purchaseUnit: "Pic" },
  ],
  ...extra,
});

async function saleOf(id: string) {
  const sale = await prisma.sale.findUniqueOrThrow({
    where: { id },
    include: { items: { orderBy: { productId: "asc" } }, payments: true },
  });
  return {
    status: sale.status,
    customerId: sale.customerId === customerId,
    orderTax: sale.orderTax.toFixed(2),
    orderTaxAmount: sale.orderTaxAmount.toFixed(2),
    discount: sale.discount.toFixed(2),
    shipping: sale.shipping.toFixed(2),
    grandTotal: sale.grandTotal.toFixed(2),
    paid: sale.paid.toFixed(2),
    due: sale.due.toFixed(2),
    paymentStatus: sale.paymentStatus,
    paymentType: sale.paymentType,
    notes: sale.notes,
    createdBy: sale.createdById === userId,
    reference: /^SA_/.test(sale.reference),
    items: sale.items
      .map((i) => [i.productId === product.a ? "a" : "b", i.quantity, i.saleUnit, i.netUnitPrice.toFixed(2), i.discountType, i.discount.toFixed(2), i.taxType, i.orderTax.toFixed(2), i.taxAmount.toFixed(2), i.subtotal.toFixed(2)])
      .sort((x, y) => (x[0] < y[0] ? -1 : 1)),
    payments: sale.payments.map((p) => [p.amount.toFixed(2), p.paymentType, p.date.toISOString().slice(0, 10), p.createdById === userId]),
  };
}

describe("Retail saveNewSale (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    customerId = (await prisma.customer.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Retail check" }, select: { id: true } })).id;
    for (const [key, price] of [["a", "18.00"], ["b", "10.75"]] as const) {
      product[key] = (await prisma.product.create({ data: { name: `RC ${key}`, code: `RC-${key}-${Date.now()}`, price, categoryId, brandId, unitId, taxType: "EXCLUSIVE" }, select: { id: true } })).id;
      await prisma.productStock.create({ data: { productId: product[key], warehouseId, quantity: 10 } });
    }
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("Received: the sale, its items, the first payment, and stock out", async () => {
    const result = await saveNewSale(input(), userId);
    assert.ok(result.ok && "id" in result, JSON.stringify(result));
    assert.deepEqual(await saleOf(result.id as string), {
      status: "RECEIVED",
      customerId: true,
      orderTax: "5.00",
      orderTaxAmount: "2.16",
      discount: "3.00",
      shipping: "2.50",
      grandTotal: "47.89",
      paid: "20.00",
      due: "27.89",
      paymentStatus: "PARTIAL",
      paymentType: "CARD",
      notes: "Retail check",
      createdBy: true,
      reference: true,
      items: [
        ["a", 2, "Pic", "18.00", "FIXED", "1.00", "EXCLUSIVE", "7.50", "2.55", "36.55"],
        ["b", 1, "Pic", "10.75", "PERCENTAGE", "10.00", "INCLUSIVE", "7.50", "0.68", "9.68"],
      ],
      payments: [["20.00", "CARD", "2026-11-01", true]],
    });
    assert.deepEqual([await stockOf(product.a), await stockOf(product.b)], [8, 9]);
  });

  test("Pending moves no stock; nothing paid → Unpaid", async () => {
    const result = await saveNewSale(input({ status: "PENDING", paidAmount: "0" }), userId);
    assert.ok(result.ok && "id" in result);
    const sale = await saleOf(result.id as string);
    assert.deepEqual([sale.status, sale.paid, sale.paymentStatus, sale.paymentType, sale.payments], ["PENDING", "0.00", "UNPAID", null, []]);
    assert.deepEqual([await stockOf(product.a), await stockOf(product.b)], [8, 9]);
  });

  test("refused: not enough stock (nothing written), paid over the total, a bad input", async () => {
    const sales = await prisma.sale.count();
    const short = await saveNewSale(input({ items: [{ ...input().items[0], quantity: 50 }] }), userId);
    assert.equal(short.ok, false);
    assert.match((short as { error: string }).error, /^Not enough stock for RC a in .+ \(have 8, selling 50\)\.$/);
    assert.equal(await prisma.sale.count(), sales, "no sale");
    assert.deepEqual([await stockOf(product.a), await stockOf(product.b)], [8, 9], "no stock moved");

    const over = await saveNewSale(input({ paidAmount: "47.90" }), userId);
    assert.deepEqual(over.ok === false && "fieldErrors" in over && over.fieldErrors?.paidAmount, ["Paid can't be more than the grand total (₦47.89)."]);
    const bad = await saveNewSale(input({ customerId: "" }), userId);
    assert.equal(bad.ok, false);
    assert.equal(await prisma.sale.count(), sales);
  });
});
