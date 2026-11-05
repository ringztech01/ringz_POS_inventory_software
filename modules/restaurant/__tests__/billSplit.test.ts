// Run with: npx tsx --test modules/restaurant/__tests__/billSplit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { billPartLabel, MAX_BILL_PARTS, splitByAmounts, splitByItems, splitEqually, type SplitLine, type SplitResult } from "../lib/billSplit";
import { orderTotals } from "../lib/orderTotals";
import { splitBillSchema } from "../schemas/bill";

const fixed = (result: SplitResult) => (result.ok ? result.amounts.map((a) => a.toFixed(2)) : result.error);
const sum = (result: SplitResult) => (result.ok ? result.amounts.reduce((s, a) => s.plus(a), new Decimal(0)).toFixed(2) : "");

const line = (id: string, name: string, quantity: number, unitPrice: string, taxRate = "0"): SplitLine => ({
  id,
  name,
  quantity,
  unitPrice,
  taxType: "EXCLUSIVE",
  taxRate,
  cancelledAt: null,
  deletedAt: null,
});
// 2× Jollof ₦18 and 1× Chapman ₦10 (+7.5% tax): sub total ₦46.00.
const lines = [line("a", "Jollof", 2, "18.00"), line("b", "Chapman", 1, "10.00", "7.5")];

test("equal: rounded down to the kobo, the last part takes the rest", () => {
  assert.deepEqual(fixed(splitEqually("100", 3)), ["33.33", "33.33", "33.34"]);
  assert.deepEqual(fixed(splitEqually("51.35", 2)), ["25.67", "25.68"]);
  assert.deepEqual(fixed(splitEqually("10", 4)), ["2.50", "2.50", "2.50", "2.50"]);
  assert.deepEqual(fixed(splitEqually("100", 6)), ["16.66", "16.66", "16.66", "16.66", "16.66", "16.70"]);
  assert.equal(fixed(splitEqually("0.02", 3)), "₦0.02 is too little to split 3 ways.");
  assert.equal(fixed(splitEqually("100", 1)), `Split 2 to ${MAX_BILL_PARTS} ways.`);
  assert.equal(fixed(splitEqually("100", MAX_BILL_PARTS + 1)), `Split 2 to ${MAX_BILL_PARTS} ways.`);
});

test("equal: the parts always add up to the total exactly", () => {
  for (const total of ["0.30", "1.00", "51.35", "99.99", "12345.67", "1000000.01"]) {
    for (let ways = 2; ways <= MAX_BILL_PARTS; ways++) {
      const result = splitEqually(total, ways);
      if (!result.ok) continue;
      assert.equal(sum(result), total, `${total} ÷ ${ways}`);
      const [last, ...others] = [...result.amounts].reverse();
      assert.ok(others.every((a) => a.lte(last)), "the last part is never less than the others");
    }
  }
});

test("by amount: the guests' amounts, and the last part pays the rest", () => {
  assert.deepEqual(fixed(splitByAmounts("51.35", ["20", "20"])), ["20.00", "20.00", "11.35"]);
  assert.deepEqual(fixed(splitByAmounts("51.35", ["51.34"])), ["51.34", "0.01"]);
  assert.equal(fixed(splitByAmounts("51.35", ["51.35"])), "Those parts come to ₦51.35 but the bill is ₦51.35. Leave something for the last part.");
  assert.equal(fixed(splitByAmounts("51.35", ["30", "30"])), "Those parts come to ₦60.00 but the bill is ₦51.35. Leave something for the last part.");
  assert.equal(fixed(splitByAmounts("51.35", ["0", "10"])), "Every part needs an amount above ₦0.00.");
  assert.equal(fixed(splitByAmounts("51.35", [])), `Split into 2 to ${MAX_BILL_PARTS} parts.`);
  assert.equal(sum(splitByAmounts("51.35", ["12.34", "5.67", "0.01"])), "51.35");
});

test("by item: each guest's lines and tax, with the service charge shared by sub total", () => {
  const bill = orderTotals(lines, "10"); // 46 + 0.75 tax + 4.60 service = 51.35
  // Guest 1: 2× Jollof 36 + service 3.60 = 39.60. Guest 2: the rest = 10 + 0.75 + 1.00.
  assert.deepEqual(fixed(splitByItems(lines, [[{ lineId: "a", quantity: 2 }], [{ lineId: "b", quantity: 1 }]], bill)), ["39.60", "11.75"]);
  // One Jollof each; the Chapman's on guest 2.
  const shared = splitByItems(lines, [[{ lineId: "a", quantity: 1 }], [{ lineId: "a", quantity: 1 }, { lineId: "b", quantity: 1 }]], bill);
  assert.deepEqual(fixed(shared), ["19.80", "31.55"]);
  assert.equal(sum(shared), "51.35");
});

test("by item: the discount is shared out too; the parts still add up", () => {
  const bill = orderTotals(lines, "10", { discountType: "PERCENT", discountValue: "10" }); // total 46.29
  // Guest 1: 36 − 3.60 discount + 3.24 service = 35.64; guest 2: 10 + 0.75 − 1.00 + 0.90 = 10.65.
  const result = splitByItems(lines, [[{ lineId: "a", quantity: 2 }], [{ lineId: "b", quantity: 1 }]], bill);
  assert.deepEqual(fixed(result), ["35.64", "10.65"]);
  const amount = orderTotals(lines, "10", { discountType: "AMOUNT", discountValue: "7" });
  assert.equal(sum(splitByItems(lines, [[{ lineId: "b", quantity: 1 }], [{ lineId: "a", quantity: 1 }], [{ lineId: "a", quantity: 1 }]], amount)), amount.total.toFixed(2));
});

test("by item: every unit exactly once, and every guest has something", () => {
  const bill = orderTotals(lines, "10");
  assert.equal(fixed(splitByItems(lines, [[{ lineId: "a", quantity: 1 }], [{ lineId: "b", quantity: 1 }]], bill)), "Assign every Jollof (1 of 2 assigned).");
  assert.equal(
    fixed(splitByItems(lines, [[{ lineId: "a", quantity: 2 }], [{ lineId: "a", quantity: 1 }, { lineId: "b", quantity: 1 }]], bill)),
    "More Jollof assigned than were ordered (3 of 2).",
  );
  assert.equal(fixed(splitByItems(lines, [[{ lineId: "a", quantity: 2 }, { lineId: "b", quantity: 1 }], []], bill)), "Guest 2 has nothing assigned yet.");
  assert.equal(
    fixed(splitByItems(lines, [[{ lineId: "a", quantity: 2 }], [{ lineId: "b", quantity: 1 }, { lineId: "gone", quantity: 1 }]], bill)),
    "An item isn't on the bill any more. Close the split and try again.",
  );
  assert.equal(fixed(splitByItems(lines, [[{ lineId: "a", quantity: 2 }, { lineId: "b", quantity: 1 }]], bill)), `Split between 2 and ${MAX_BILL_PARTS} guests.`);
  // The same line twice for one guest adds up.
  assert.equal(sum(splitByItems(lines, [[{ lineId: "a", quantity: 1 }, { lineId: "a", quantity: 1 }], [{ lineId: "b", quantity: 1 }]], bill)), "51.35");
});

test("by item: a ₦0 guest is fine; a last part below ₦0 is refused", () => {
  const free = [...lines, line("c", "Water", 1, "0.00")];
  const bill = orderTotals(free, "10");
  assert.deepEqual(fixed(splitByItems(free, [[{ lineId: "c", quantity: 1 }], [{ lineId: "a", quantity: 2 }, { lineId: "b", quantity: 1 }]], bill)), ["0.00", "51.35"]);
  // The guard itself, with a forced total lower than the guests' own shares (each ₦0.01 + ₦0.01 tax).
  const odd = ["x", "y", "z"].map((id) => line(id, id, 1, "0.01", "50"));
  const oddBill = { ...orderTotals(odd, "0"), total: new Decimal("0.03") };
  const result = splitByItems([...odd, line("w", "Water", 1, "0.00")], [[{ lineId: "x", quantity: 1 }], [{ lineId: "y", quantity: 1 }], [{ lineId: "z", quantity: 1 }], [{ lineId: "w", quantity: 1 }]], oddBill);
  assert.equal(fixed(result), "Guest 4's part comes out below ₦0.00. Give them one of the priced items.");
});

test("labels", () => {
  assert.equal(billPartLabel("EQUAL", 2, 3), "2 of 3");
  assert.equal(billPartLabel("ITEMS", 1, 3), "Guest 1");
  assert.equal(billPartLabel("AMOUNT", 3, 3), "Part 3");
});

test("the split schema: ids and counts only", () => {
  const base = { orderId: "o1", version: 2 };
  assert.ok(splitBillSchema.safeParse({ ...base, split: { mode: "EQUAL", ways: 3 } }).success);
  assert.equal(splitBillSchema.safeParse({ ...base, split: { mode: "EQUAL", ways: 1 } }).success, false);
  assert.equal(splitBillSchema.safeParse({ ...base, split: { mode: "EQUAL", ways: 2.5 } }).success, false);
  assert.ok(splitBillSchema.safeParse({ ...base, split: { mode: "AMOUNT", amounts: ["5000", "2500.50"] } }).success);
  assert.equal(splitBillSchema.safeParse({ ...base, split: { mode: "AMOUNT", amounts: ["-5"] } }).error?.issues[0]?.message, "Enter amounts like 5000 or 2500.50.");
  assert.equal(splitBillSchema.safeParse({ ...base, split: { mode: "AMOUNT", amounts: [] } }).success, false);
  assert.ok(splitBillSchema.safeParse({ ...base, split: { mode: "ITEMS", parts: [[{ lineId: "a", quantity: 1 }], [{ lineId: "b", quantity: 1 }]] } }).success);
  assert.equal(splitBillSchema.safeParse({ ...base, split: { mode: "ITEMS", parts: [[{ lineId: "a", quantity: 0 }], [{ lineId: "b", quantity: 1 }]] } }).success, false);
  // No amount for an item part reaches the server.
  const parsed = splitBillSchema.parse({ ...base, split: { mode: "ITEMS", parts: [[{ lineId: "a", quantity: 1, amount: "1" }], [{ lineId: "b", quantity: 1 }]] } });
  assert.deepEqual(parsed.split.mode === "ITEMS" && parsed.split.parts[0][0], { lineId: "a", quantity: 1 });
});
