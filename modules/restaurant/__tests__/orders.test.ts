// Run with: npx tsx --test modules/restaurant/__tests__/orders.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineDetail, readModifiers } from "../lib/orderLines";
import { orderDetailsSchema } from "../schemas/order";

const ok = (input: unknown) => orderDetailsSchema.safeParse(input).success;
const base = { orderId: "o1", version: 3 };

test("ticket header changes: type, waiter or guests 1–30, with the screen's version", () => {
  assert.equal(ok({ ...base, change: { field: "type", value: "TAKEAWAY" } }), true);
  assert.equal(ok({ ...base, change: { field: "waiterId", value: "u1" } }), true);
  assert.equal(ok({ ...base, change: { field: "guests", value: 30 } }), true);
  assert.equal(ok({ ...base, change: { field: "guests", value: 0 } }), false);
  assert.equal(ok({ ...base, change: { field: "guests", value: 31 } }), false);
  assert.equal(ok({ ...base, change: { field: "guests", value: 2.5 } }), false);
  assert.equal(ok({ ...base, change: { field: "type", value: "PICKUP" } }), false);
  assert.equal(ok({ ...base, change: { field: "waiterId", value: "" } }), false);
  assert.equal(ok({ ...base, change: { field: "status", value: "BILLED" } }), false, "only the header fields");
  assert.equal(ok({ orderId: "o1", change: { field: "guests", value: 2 } }), false, "the version is required");
  assert.equal(ok({ ...base, version: -1, change: { field: "guests", value: 2 } }), false);
});

test("a line's grey detail: modifier names, then the note", () => {
  const modifiers = readModifiers([
    { group: "Portion", name: "Large", price: "4.00" },
    { group: "Extras", name: "Extra plantain", price: "2.00" },
  ]);
  assert.equal(lineDetail(modifiers, "no pepper"), "Large · Extra plantain · no pepper");
  assert.equal(lineDetail([], null), "");
  assert.deepEqual(readModifiers("not a list"), []);
});
