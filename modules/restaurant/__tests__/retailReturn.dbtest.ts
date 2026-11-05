// Retail's sale-return path (app/(dashboard)/sales/returns/save-return.ts →
// saveNewSaleReturn, behind the Sales › Returns form) pinned down before and
// after Part 6's refactor of it (the restaurant's refunds run it in their own
// transaction): the same input saves the same return, refund figures and
// stock. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/retailReturn.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { saveNewSale } from "@/app/(dashboard)/sales/save-sale";
import { saveNewSaleReturn } from "@/app/(dashboard)/sales/returns/save-return";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let warehouseId = "";
let customerId = "";
let productId = "";
let saleId = "";
let saleItemId = "";
let saleReference = "";
const stock = async () => (await prisma.productStock.findFirstOrThrow({ where: { productId, warehouseId } })).quantity;
const returnInput = (extra: Record<string, unknown> = {}, line: Record<string, unknown> = {}) => ({
  saleId,
  date: "2026-11-04",
  status: "RECEIVED",
  orderTax: "0",
  discount: "1.00",
  shipping: "0",
  notes: "Retail return check",
  items: [{ saleItemId, productId: "ignored", quantity: 2, unitCost: "18.00", discountType: "FIXED", discount: "0", taxType: "EXCLUSIVE", taxRate: "7.5", purchaseUnit: "Pic", ...line }],
  ...extra,
});
async function returnOf(id: string) {
  const r = await prisma.saleReturn.findUniqueOrThrow({ where: { id }, include: { items: true, payments: true } });
  return {
    reference: /^SR_/.test(r.reference),
    sale: r.saleId === saleId,
    customer: r.customerId === customerId,
    warehouse: r.warehouseId === warehouseId,
    status: r.status,
    discount: r.discount.toFixed(2),
    grandTotal: r.grandTotal.toFixed(2),
    paid: r.paid.toFixed(2),
    due: r.due.toFixed(2),
    paymentStatus: r.paymentStatus,
    notes: r.notes,
    createdBy: r.createdById === userId,
    items: r.items.map((i) => [i.saleItemId === saleItemId, i.productId === productId, i.quantity, i.saleUnit, i.netUnitPrice.toFixed(2), i.orderTax.toFixed(2), i.taxAmount.toFixed(2), i.subtotal.toFixed(2)]),
    payments: r.payments.length,
  };
}

describe("Retail saveNewSaleReturn (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    customerId = (await prisma.customer.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Return check" }, select: { id: true } })).id;
    productId = (await prisma.product.create({ data: { name: "RR Item", code: `RR-${Date.now()}`, price: "18.00", categoryId, brandId, unitId, taxType: "EXCLUSIVE" }, select: { id: true } })).id;
    await prisma.productStock.create({ data: { productId, warehouseId, quantity: 10 } });
    const sale = await saveNewSale(
      {
        date: "2026-11-04",
        status: "RECEIVED",
        warehouseId,
        customerId,
        orderTax: "0",
        discount: "0",
        shipping: "0",
        paidAmount: "0",
        paymentType: "CASH",
        items: [{ productId, quantity: 3, unitCost: "18.00", discountType: "FIXED", discount: "0", taxType: "EXCLUSIVE", taxRate: "7.5", purchaseUnit: "Pic" }],
      },
      userId,
    );
    assert.ok(sale.ok && "id" in sale);
    saleId = sale.id as string;
    const row = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
    saleItemId = row.items[0].id;
    saleReference = row.reference;
    assert.equal(await stock(), 7);
  });

  after(async () => {
    await prisma.$disconnect();
  });

  test("Received: the return against the sale (its customer and warehouse), nothing refunded yet, stock back in", async () => {
    const result = await saveNewSaleReturn(returnInput(), userId);
    assert.ok(result.ok && "id" in result, JSON.stringify(result));
    assert.deepEqual(await returnOf(result.id as string), {
      reference: true,
      sale: true,
      customer: true,
      warehouse: true,
      status: "RECEIVED",
      discount: "1.00",
      grandTotal: "37.70",
      paid: "0.00",
      due: "37.70",
      paymentStatus: "UNPAID",
      notes: "Retail return check",
      createdBy: true,
      items: [[true, true, 2, "Pic", "18.00", "7.50", "2.70", "38.70"]],
      payments: 0,
    });
    assert.equal(await stock(), 9);
  });

  test("Pending moves no stock", async () => {
    const result = await saveNewSaleReturn(returnInput({ status: "PENDING", discount: "0" }, { quantity: 1 }), userId);
    assert.ok(result.ok && "id" in result);
    assert.deepEqual([(await returnOf(result.id as string)).status, (await returnOf(result.id as string)).grandTotal], ["PENDING", "19.35"]);
    assert.equal(await stock(), 9);
  });

  test("refused: more than is left returnable (nothing written), a line not on the sale", async () => {
    const returns = await prisma.saleReturn.count();
    const over = await saveNewSaleReturn(returnInput({ discount: "0" }, { quantity: 1 }), userId);
    assert.deepEqual(over, { ok: false, error: `Can't return 1 × RR Item — only 0 left returnable on ${saleReference}.` });
    assert.equal(await prisma.saleReturn.count(), returns);
    assert.equal(await stock(), 9);
    const stranger = await saveNewSaleReturn(returnInput({}, { saleItemId: "not-on-the-sale" }), userId);
    assert.ok(!stranger.ok && "fieldErrors" in stranger && stranger.fieldErrors?.items?.[0]?.startsWith("One of the lines isn't on"));
  });
});
