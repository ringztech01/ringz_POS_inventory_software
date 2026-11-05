// Run with: npx tsx --test modules/restaurant/__tests__/tableMoves.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergedOrderStatus, pickableTables } from "../lib/tableMoves";
import { mergeOrdersSchema, moveOrderSchema } from "../schemas/orderFlow";

const tables = [
  { id: "t1", name: "T1", warehouseId: "w1", status: "Occupied", orderId: "o1" },
  { id: "t2", name: "T2", warehouseId: "w1", status: "Available", orderId: null },
  { id: "t3", name: "T3", warehouseId: "w1", status: "Reserved", orderId: null },
  { id: "t4", name: "T4", warehouseId: "w1", status: "Cleaning", orderId: null },
  { id: "t5", name: "T5", warehouseId: "w1", status: "Occupied", orderId: "o5" },
  { id: "t6", name: "T6", warehouseId: "w2", status: "Available", orderId: null },
  { id: "t7", name: "T7", warehouseId: "w2", status: "Occupied", orderId: "o7" },
] as const;
const names = (list: readonly { name: string }[]) => list.map((t) => t.name);

test("Move lists the free tables (Available or Reserved) in the order's warehouse", () => {
  assert.deepEqual(names(pickableTables([...tables], "t1", "w1", "move")), ["T2", "T3"]);
});

test("Merge lists the other occupied tables in the order's warehouse", () => {
  assert.deepEqual(names(pickableTables([...tables], "t1", "w1", "merge")), ["T5"]);
  assert.deepEqual(names(pickableTables([...tables], "t7", "w2", "merge")), []);
});

test("the joined order's status follows its lines", () => {
  assert.equal(mergedOrderStatus({ live: 3, sent: 3, unserved: 0 }, "SENT"), "SERVED");
  assert.equal(mergedOrderStatus({ live: 3, sent: 2, unserved: 1 }, "SERVED"), "SENT");
  assert.equal(mergedOrderStatus({ live: 2, sent: 0, unserved: 2 }, "OPEN"), "OPEN");
  assert.equal(mergedOrderStatus({ live: 0, sent: 0, unserved: 0 }, "OPEN"), "OPEN");
});

test("Move and Merge carry the moving order's version", () => {
  assert.equal(moveOrderSchema.safeParse({ orderId: "o1", version: 3, tableId: "t2" }).success, true);
  assert.equal(moveOrderSchema.safeParse({ orderId: "o1", tableId: "t2" }).success, false);
  assert.equal(moveOrderSchema.safeParse({ orderId: "o1", version: 3, tableId: "" }).success, false);
  assert.equal(mergeOrdersSchema.safeParse({ orderId: "o1", version: 3, targetOrderId: "o5" }).success, true);
  assert.equal(mergeOrdersSchema.safeParse({ orderId: "o1", version: -1, targetOrderId: "o5" }).success, false);
});
