// Run with: npx tsx --test lib/validations/expense-category.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { expenseCategorySchema } from "./expense-category";

const messages = (input: unknown) => {
  const r = expenseCategorySchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("expenseCategorySchema", () => {
  test("trims the name", () => {
    const r = expenseCategorySchema.safeParse({ name: "  Utilities  " });
    assert.ok(r.success);
    assert.equal(r.data.name, "Utilities");
  });

  test("name is required (missing, empty or blank)", () => {
    assert.deepEqual(messages({}), ["Name is required."]);
    assert.deepEqual(messages({ name: "" }), ["Name is required."]);
    assert.deepEqual(messages({ name: "   " }), ["Name is required."]);
  });

  test("max 150 characters (after trimming)", () => {
    assert.deepEqual(messages({ name: "a".repeat(150) }), []);
    assert.deepEqual(messages({ name: `  ${"a".repeat(150)}  ` }), []);
    assert.deepEqual(messages({ name: "a".repeat(151) }), ["Name can be at most 150 characters."]);
  });
});
