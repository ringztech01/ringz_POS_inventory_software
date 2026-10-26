// Run with: npx tsx --test lib/validations/expense.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { expenseSchema } from "./expense";

const valid = {
  date: "2026-10-22",
  title: "  Generator fuel  ",
  warehouseId: "w1",
  expenseCategoryId: "c1",
  amount: "1500.50",
  details: "",
};
const issues = (input: unknown) => {
  const r = expenseSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("expenseSchema", () => {
  test("accepts a valid expense: trims title, empty details → undefined, date at UTC midnight", () => {
    const r = expenseSchema.safeParse(valid);
    assert.ok(r.success);
    assert.equal(r.data.title, "Generator fuel");
    assert.equal(r.data.details, undefined);
    assert.equal(r.data.date.toISOString(), "2026-10-22T00:00:00.000Z");
    assert.equal(r.data.amount, "1500.50");
  });

  test("date must be a real calendar day", () => {
    assert.deepEqual(issues({ ...valid, date: "2026-02-31" }), ["date: Enter a valid date."]);
    // (The shared dateOnly may report an empty value twice; the form shows the first.)
    assert.deepEqual([...new Set(issues({ ...valid, date: "" }))], ["date: Enter a valid date."]);
  });

  test("title, warehouse and category are required", () => {
    assert.deepEqual(issues({ ...valid, title: "   " }), ["title: Expense title is required."]);
    assert.deepEqual(issues({ ...valid, warehouseId: "" }), ["warehouseId: Warehouse is required."]);
    assert.deepEqual(issues({ ...valid, expenseCategoryId: "" }), ["expenseCategoryId: Expense category is required."]);
  });

  test("amount: required, a decimal string with ≤ 2 places, more than 0", () => {
    assert.deepEqual(issues({ ...valid, amount: "" }), ["amount: Amount is required."]);
    assert.deepEqual(issues({ ...valid, amount: "12.345" }), ["amount: Enter a valid amount (up to 2 decimal places)."]);
    assert.deepEqual(issues({ ...valid, amount: "1e3" }), ["amount: Enter a valid amount (up to 2 decimal places)."]);
    assert.deepEqual(issues({ ...valid, amount: "-5" }), ["amount: Enter a valid amount (up to 2 decimal places)."]);
    assert.deepEqual(issues({ ...valid, amount: "abc" }), ["amount: Enter a valid amount (up to 2 decimal places)."]);
    assert.deepEqual(issues({ ...valid, amount: "0" }), ["amount: Amount must be more than 0."]);
    assert.deepEqual(issues({ ...valid, amount: "0.00" }), ["amount: Amount must be more than 0."]);
    assert.deepEqual(issues({ ...valid, amount: "0.01" }), []);
    assert.deepEqual(issues({ ...valid, amount: 1500 }), ["amount: Amount is required."]);
  });

  test("details optional, max 2000", () => {
    assert.deepEqual(issues({ ...valid, details: "Paid in cash" }), []);
    assert.deepEqual(issues({ ...valid, details: "x".repeat(2001) }), ["details: Details can be at most 2000 characters."]);
  });
});
