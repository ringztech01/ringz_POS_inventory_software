// Run with: npx tsx --test lib/validations/purchase.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { purchaseSchema } from "./purchase";

const item = {
  productId: "p1",
  quantity: 2,
  unitCost: "1000",
  discountType: "FIXED",
  discount: "0",
  taxType: "EXCLUSIVE",
  taxRate: "7.5",
  purchaseUnit: "Pic",
};

const valid = {
  date: "2026-10-14",
  warehouseId: "w1",
  supplierId: "s1",
  status: "RECEIVED",
  orderTax: "",
  discount: "",
  shipping: "",
  notes: "",
  items: [item],
};

function messages(input: unknown): string[] {
  const result = purchaseSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("purchaseSchema", () => {
  test("accepts a valid purchase; empty money fields become 0 and the date is UTC midnight", () => {
    const result = purchaseSchema.safeParse(valid);
    assert.ok(result.success);
    assert.equal(result.data.orderTax, "0");
    assert.equal(result.data.discount, "0");
    assert.equal(result.data.shipping, "0");
    assert.equal(result.data.notes, undefined);
    assert.equal(result.data.date.toISOString(), "2026-10-14T00:00:00.000Z");
  });

  test("requires warehouse, supplier and at least one item", () => {
    const msgs = messages({ ...valid, warehouseId: "", supplierId: "", items: [] });
    assert.ok(msgs.includes("Warehouse is required."));
    assert.ok(msgs.includes("Supplier is required."));
    assert.ok(msgs.includes("Add at least one item."));
  });

  test("rejects an impossible calendar date", () => {
    assert.deepEqual(messages({ ...valid, date: "2026-02-31" }), ["Enter a valid date."]);
  });

  test("rejects unknown status / tax type / discount type / purchase unit", () => {
    assert.equal(messages({ ...valid, status: "SHIPPED" }).length, 1);
    assert.equal(messages({ ...valid, items: [{ ...item, taxType: "VAT" }] }).length, 1);
    assert.equal(messages({ ...valid, items: [{ ...item, discountType: "BOGO" }] }).length, 1);
    assert.equal(messages({ ...valid, items: [{ ...item, purchaseUnit: "Crate" }] }).length, 1);
  });

  test("quantity must be a whole number ≥ 1", () => {
    assert.deepEqual(messages({ ...valid, items: [{ ...item, quantity: 0 }] }), ["Quantity must be at least 1."]);
    assert.deepEqual(messages({ ...valid, items: [{ ...item, quantity: 1.5 }] }), ["Quantity must be a whole number."]);
  });

  test("product ids must be unique", () => {
    assert.deepEqual(messages({ ...valid, items: [item, { ...item }] }), ["Each product can only appear once."]);
  });

  test("money must be a non-negative decimal with at most 2 places", () => {
    assert.equal(messages({ ...valid, shipping: "-5" }).length, 1);
    assert.equal(messages({ ...valid, shipping: "1.234" }).length, 1);
    assert.equal(messages({ ...valid, items: [{ ...item, unitCost: "" }] }).length, 1);
  });

  test("percentages are capped at 100", () => {
    assert.deepEqual(messages({ ...valid, orderTax: "100.01" }), ["Order tax can't be more than 100%."]);
    assert.deepEqual(messages({ ...valid, items: [{ ...item, taxRate: "150" }] }), ["Order tax can't be more than 100%."]);
  });

  test("line discount: percentage ≤ 100, fixed ≤ unit cost", () => {
    assert.deepEqual(messages({ ...valid, items: [{ ...item, discountType: "PERCENTAGE", discount: "101" }] }), [
      "A percentage discount can't be more than 100%.",
    ]);
    assert.deepEqual(messages({ ...valid, items: [{ ...item, discount: "1000.01" }] }), [
      "Discount can't be more than the product cost.",
    ]);
    assert.deepEqual(messages({ ...valid, items: [{ ...item, discount: "1000" }] }), []);
  });
});
