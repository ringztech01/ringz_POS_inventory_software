// Run with: npx tsx --test "app/(pos)/pos/sale-input.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { saleSchema } from "@/lib/validations/sale";
import { posCheckoutToSaleInput, type PosCheckout } from "./sale-input";

const CHECKOUT: PosCheckout = {
  customerId: "c1",
  warehouseId: "w1",
  orderTax: "5",
  discount: "1000",
  shipping: "250",
  paidAmount: "1500.00",
  paymentType: "CARD",
  lines: [
    {
      productId: "p1",
      quantity: 2,
      unitCost: "1000.00",
      discountType: "PERCENTAGE",
      discount: "10",
      taxType: "EXCLUSIVE",
      taxRate: "7.5",
      purchaseUnit: "Pic",
    },
  ],
};

test("a cart becomes a valid sale input: today, Received, no notes", () => {
  const parsed = saleSchema.parse(posCheckoutToSaleInput(CHECKOUT, "2026-10-28"));
  assert.equal(parsed.date.toISOString(), "2026-10-28T00:00:00.000Z");
  assert.equal(parsed.status, "RECEIVED");
  assert.equal(parsed.notes, undefined);
  assert.equal(parsed.customerId, "c1");
  assert.equal(parsed.warehouseId, "w1");
  assert.equal(parsed.paymentType, "CARD");
  assert.equal(String(parsed.paidAmount), "1500.00");
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].quantity, 2);
  assert.equal(parsed.items[0].discountType, "PERCENTAGE");
});

test("the client can't choose the date, status or notes", () => {
  const sneaky = { ...CHECKOUT, date: "2020-01-01", status: "PENDING", notes: "x", lines: [{ ...CHECKOUT.lines[0], saleItemId: "s", extra: 1 }] };
  const input = posCheckoutToSaleInput(sneaky, "2026-10-28");
  assert.equal(input.date, "2026-10-28");
  assert.equal(input.status, "RECEIVED");
  assert.equal(input.notes, "");
  assert.deepEqual(Object.keys((input.items as object[])[0]).sort(), [
    "discount",
    "discountType",
    "productId",
    "purchaseUnit",
    "quantity",
    "taxRate",
    "taxType",
    "unitCost",
  ]);
});

test("garbage is left for saleSchema to reject", () => {
  assert.equal(saleSchema.safeParse(posCheckoutToSaleInput(null, "2026-10-28")).success, false);
  assert.equal(saleSchema.safeParse(posCheckoutToSaleInput({ ...CHECKOUT, lines: [] }, "2026-10-28")).success, false);
  assert.equal(saleSchema.safeParse(posCheckoutToSaleInput({ ...CHECKOUT, lines: "nope" }, "2026-10-28")).success, false);
});
