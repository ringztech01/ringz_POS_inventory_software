// Run with: npx tsx --test modules/restaurant/__tests__/diningArea.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { diningAreaSchema } from "../schemas/diningArea";

const issues = (input: unknown) => {
  const r = diningAreaSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

test("trims the name and keeps the warehouse", () => {
  assert.deepEqual(diningAreaSchema.parse({ name: "  Patio ", warehouseId: "wh1" }), { name: "Patio", warehouseId: "wh1" });
});

test("name and warehouse are required", () => {
  assert.deepEqual(issues({ name: "   ", warehouseId: "" }), ["name: Name is required.", "warehouseId: Choose a warehouse."]);
  assert.deepEqual(issues({}), ["name: Name is required.", "warehouseId: Choose a warehouse."]);
});

test("name is at most 60 characters", () => {
  assert.deepEqual(issues({ name: "a".repeat(61), warehouseId: "wh1" }), ["name: Name can be at most 60 characters."]);
  assert.equal(diningAreaSchema.safeParse({ name: "a".repeat(60), warehouseId: "wh1" }).success, true);
});
