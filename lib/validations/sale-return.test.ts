// Run with: npx tsx --test lib/validations/sale-return.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { saleReturnSchema } from "./sale-return";

const item = {
  saleItemId: "si1",
  productId: "p1",
  quantity: 2,
  unitCost: "500",
  discountType: "FIXED",
  discount: "0",
  taxType: "EXCLUSIVE",
  taxRate: "0",
  purchaseUnit: "Pic",
};
const valid = { saleId: "s1", date: "2026-10-16", status: "COMPLETED", orderTax: "", discount: "", shipping: "", notes: "", items: [item] };
const messages = (input: unknown) => {
  const r = saleReturnSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("saleReturnSchema", () => {
  test("accepts a valid return (Completed); no customer/warehouse fields", () => {
    const r = saleReturnSchema.safeParse({ ...valid, customerId: "ignored", warehouseId: "ignored" });
    assert.ok(r.success);
    assert.equal("warehouseId" in r.data, false);
    assert.equal("customerId" in r.data, false);
  });

  test("status must be Pending / Received / Completed", () => {
    for (const status of ["PENDING", "RECEIVED", "COMPLETED"]) assert.deepEqual(messages({ ...valid, status }), []);
    assert.deepEqual(messages({ ...valid, status: "ORDERED" }), ["Status is required."]);
  });

  test("sale, at least one item, qty ≥ 1", () => {
    assert.ok(messages({ ...valid, saleId: "" }).includes("Sale is required."));
    assert.ok(messages({ ...valid, items: [] }).includes("Add at least one item."));
    assert.deepEqual(messages({ ...valid, items: [{ ...item, quantity: 0 }] }), ["Quantity must be at least 1."]);
  });

  test("each sale line only once", () => {
    assert.deepEqual(messages({ ...valid, items: [item, { ...item, productId: "p2" }] }), ["Each sale line can only appear once."]);
  });

  test("line price/discount rules still apply", () => {
    assert.deepEqual(messages({ ...valid, items: [{ ...item, discount: "600" }] }), ["Discount can't be more than the product price."]);
    assert.equal(messages({ ...valid, items: [{ ...item, discountType: "BOGO" }] }).length, 1);
  });
});
