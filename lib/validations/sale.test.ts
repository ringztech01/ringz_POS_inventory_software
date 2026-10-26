// Run with: npx tsx --test lib/validations/sale.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { salePaymentSchema, saleSchema } from "./sale";

const item = {
  productId: "p1",
  quantity: 2,
  unitCost: "1500",
  discountType: "FIXED",
  discount: "0",
  taxType: "EXCLUSIVE",
  taxRate: "0",
  purchaseUnit: "Pic",
};
const valid = {
  date: "2026-10-15",
  warehouseId: "w1",
  customerId: "c1",
  status: "RECEIVED",
  orderTax: "",
  discount: "",
  shipping: "",
  notes: "",
  items: [item],
  paidAmount: "",
  paymentType: "CASH",
};
const messages = (input: unknown) => {
  const r = saleSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("saleSchema", () => {
  test("accepts a valid sale; empty paid amount becomes 0", () => {
    const r = saleSchema.safeParse(valid);
    assert.ok(r.success);
    assert.equal(r.data.paidAmount, "0");
    assert.equal(r.data.paymentType, "CASH");
  });

  test("customer, warehouse and at least one item are required", () => {
    const msgs = messages({ ...valid, customerId: "", warehouseId: "", items: [] });
    assert.ok(msgs.includes("Customer is required."));
    assert.ok(msgs.includes("Warehouse is required."));
    assert.ok(msgs.includes("Add at least one item."));
  });

  test("a blank unit price is allowed (server falls back to the DB price)", () => {
    const r = saleSchema.safeParse({ ...valid, items: [{ ...item, unitCost: "" }] });
    assert.ok(r.success);
    assert.equal(r.data.items[0].unitCost, undefined);
  });

  test("an edited price must be a valid 2dp amount, and a fixed discount can't exceed it", () => {
    assert.equal(messages({ ...valid, items: [{ ...item, unitCost: "12.345" }] }).length, 1);
    assert.deepEqual(messages({ ...valid, items: [{ ...item, discount: "1600" }] }), [
      "Discount can't be more than the product price.",
    ]);
  });

  test("paid amount must be ≥ 0 with at most 2 decimals; payment type must be valid", () => {
    assert.equal(messages({ ...valid, paidAmount: "-1" }).length, 1);
    assert.equal(messages({ ...valid, paidAmount: "1.234" }).length, 1);
    assert.deepEqual(messages({ ...valid, paymentType: "BITCOIN" }), ["Choose a payment type."]);
  });

  test("qty ≥ 1, unique products, valid status", () => {
    assert.deepEqual(messages({ ...valid, items: [{ ...item, quantity: 0 }] }), ["Quantity must be at least 1."]);
    assert.deepEqual(messages({ ...valid, items: [item, { ...item }] }), ["Each product can only appear once."]);
    assert.equal(messages({ ...valid, status: "SHIPPED" }).length, 1);
  });
});

describe("salePaymentSchema", () => {
  const ok = { amount: "250", paymentType: "CARD", date: "2026-10-15", notes: "" };
  test("accepts a valid payment; empty notes become undefined; date is UTC midnight", () => {
    const r = salePaymentSchema.safeParse(ok);
    assert.ok(r.success);
    assert.equal(r.data.notes, undefined);
    assert.equal(r.data.date.toISOString(), "2026-10-15T00:00:00.000Z");
  });
  test("amount must be > 0 with at most 2 decimals", () => {
    assert.deepEqual(salePaymentSchema.safeParse({ ...ok, amount: "0" }).error?.issues.map((i) => i.message), ["Amount must be more than 0."]);
    assert.equal(salePaymentSchema.safeParse({ ...ok, amount: "" }).success, false);
    assert.equal(salePaymentSchema.safeParse({ ...ok, amount: "1.005" }).success, false);
  });
  test("payment type and date are required and validated", () => {
    assert.equal(salePaymentSchema.safeParse({ ...ok, paymentType: "" }).success, false);
    assert.equal(salePaymentSchema.safeParse({ ...ok, date: "2026-02-31" }).success, false);
  });
});
