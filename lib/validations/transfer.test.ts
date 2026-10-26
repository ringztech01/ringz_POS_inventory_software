// Run with: npx tsx --test lib/validations/transfer.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { transferSchema } from "./transfer";

const item = {
  productId: "p1",
  quantity: 2,
  unitCost: "500",
  discountType: "FIXED",
  discount: "0",
  taxType: "EXCLUSIVE",
  taxRate: "0",
  purchaseUnit: "Piece",
};
const valid = {
  date: "2026-10-16",
  fromWarehouseId: "w1",
  toWarehouseId: "w2",
  status: "COMPLETED",
  orderTax: "",
  discount: "",
  shipping: "",
  notes: "",
  items: [item],
};
const issues = (input: unknown) => {
  const r = transferSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("transferSchema", () => {
  test("accepts a valid transfer", () => {
    assert.deepEqual(issues(valid), []);
  });

  test("From ≠ To, reported on toWarehouseId", () => {
    assert.deepEqual(issues({ ...valid, toWarehouseId: "w1" }), ["toWarehouseId: To must be a different warehouse from From."]);
  });

  test("both warehouses required", () => {
    assert.ok(issues({ ...valid, fromWarehouseId: "" }).includes("fromWarehouseId: From warehouse is required."));
    assert.ok(issues({ ...valid, toWarehouseId: "" }).includes("toWarehouseId: To warehouse is required."));
  });

  test("status is Pending / Sent / Completed", () => {
    for (const status of ["PENDING", "SENT", "COMPLETED"]) assert.deepEqual(issues({ ...valid, status }), []);
    assert.deepEqual(issues({ ...valid, status: "RECEIVED" }), ["status: Status is required."]);
  });

  test("at least one item, qty ≥ 1, unique products", () => {
    assert.deepEqual(issues({ ...valid, items: [] }), ["items: Add at least one item."]);
    assert.deepEqual(issues({ ...valid, items: [{ ...item, quantity: 0 }] }), ["items.0.quantity: Quantity must be at least 1."]);
    assert.deepEqual(issues({ ...valid, items: [item, item] }), ["items: Each product can only appear once."]);
  });

  test("transfer units, not purchase units", () => {
    for (const unit of ["Kilogram", "Piece", "Box"]) assert.deepEqual(issues({ ...valid, items: [{ ...item, purchaseUnit: unit }] }), []);
    assert.deepEqual(issues({ ...valid, items: [{ ...item, purchaseUnit: "Pic" }] }), ["items.0.purchaseUnit: Choose a unit."]);
  });

  test("valid enums and line discount rules", () => {
    assert.equal(issues({ ...valid, items: [{ ...item, discountType: "BOGO" }] }).length, 1);
    assert.deepEqual(issues({ ...valid, items: [{ ...item, discount: "600" }] }), [
      "items.0.discount: Discount can't be more than the product cost.",
    ]);
  });
});
