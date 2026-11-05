// Run with: npx tsx --test modules/restaurant/__tests__/tables.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tableSchema } from "../schemas/table";
import { newQrToken } from "../lib/qrToken";

const issues = (input: unknown) => {
  const r = tableSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};
const SEATS = "seats: Seats must be a whole number from 1 to 30.";

describe("tableSchema", () => {
  test("trims the name; keeps seats and area", () => {
    assert.deepEqual(tableSchema.parse({ name: " T4 ", seats: 4, areaId: "a1" }), { name: "T4", seats: 4, areaId: "a1" });
  });

  test("name and area are required; name at most 20 characters", () => {
    assert.deepEqual(issues({ name: "", seats: 2, areaId: "" }), ["name: Name is required.", "areaId: Choose an area."]);
    assert.deepEqual(issues({ name: "x".repeat(21), seats: 2, areaId: "a1" }), ["name: Name can be at most 20 characters."]);
  });

  test("seats is a whole number from 1 to 30", () => {
    for (const seats of [1, 30]) assert.deepEqual(issues({ name: "T1", seats, areaId: "a1" }), []);
    for (const seats of [0, 31, 2.5, -1, "4", "", null]) assert.deepEqual(issues({ name: "T1", seats, areaId: "a1" }), [SEATS], String(seats));
  });
});

describe("QR token", () => {
  test("24 URL-safe characters (at least 16)", () => {
    const token = newQrToken();
    assert.match(token, /^[A-Za-z0-9_-]{24}$/);
    assert.equal(encodeURIComponent(token), token);
  });

  test("unique: 10,000 tokens, no repeats", () => {
    const tokens = new Set(Array.from({ length: 10_000 }, newQrToken));
    assert.equal(tokens.size, 10_000);
  });
});
