// Run with: npx tsx --test modules/restaurant/__tests__/bill.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KitchenStatus } from "@prisma/client";
import { isBilled, isUnsent, summariseBill, type BillLineInput } from "../lib/bill";

const line = (quantity: number, unitPrice: string, kitchenStatus: KitchenStatus, extra: Partial<BillLineInput> = {}): BillLineInput => ({
  quantity,
  unitPrice,
  taxType: "EXCLUSIVE",
  taxRate: "0",
  cancelledAt: null,
  deletedAt: null,
  kitchenStatus,
  remakeOfId: null,
  ...extra,
});
const money = (s: ReturnType<typeof summariseBill>) => ({
  subTotal: s.subTotal.toFixed(2),
  serviceCharge: s.serviceCharge.toFixed(2),
  tax: s.tax.toFixed(2),
  total: s.total.toFixed(2),
});

test("billed: sent lines in any kitchen state; never New, cancelled (VOID) or removed ones", () => {
  for (const status of ["PENDING", "PREPARING", "READY", "SERVED"] as const) assert.ok(isBilled(line(1, "1", status)), status);
  assert.ok(!isBilled(line(1, "1", "NEW")));
  assert.ok(isUnsent(line(1, "1", "NEW")));
  assert.ok(!isBilled(line(1, "1", "SERVED", { cancelledAt: new Date() })));
  assert.ok(!isBilled(line(1, "1", "PENDING", { deletedAt: new Date() })));
  assert.ok(!isUnsent(line(1, "1", "NEW", { deletedAt: new Date() })), "a removed New line isn't waiting to be sent");
});

test("the totals count billed lines only", () => {
  const lines = [
    line(2, "18.00", "SERVED"),
    line(1, "10.00", "READY", { taxRate: "7.5" }),
    line(3, "6.00", "SERVED", { cancelledAt: new Date() }),
    line(1, "99.00", "PENDING", { deletedAt: new Date() }),
  ];
  const summary = summariseBill(lines, "10");
  assert.deepEqual(money(summary), { subTotal: "46.00", serviceCharge: "4.60", tax: "0.75", total: "51.35" });
  assert.deepEqual([summary.billed, summary.unsent, summary.notServed, summary.settleBlocker], [2, 0, 1, null]);
  assert.deepEqual(summary.taxRates, ["7.5"]);
});

test("unsent (New) lines are left out of the bill and block the settle", () => {
  const summary = summariseBill([line(2, "18.00", "SERVED"), line(1, "50.00", "NEW")], "10");
  assert.equal(money(summary).subTotal, "36.00");
  assert.equal(summary.unsent, 1);
  assert.equal(summary.settleBlocker, "1 line hasn't been sent to the kitchen. Send or remove it first.");
  const two = summariseBill([line(1, "5", "NEW"), line(1, "5", "NEW"), line(1, "5", "SERVED", { cancelledAt: new Date() })], "10");
  assert.equal(two.settleBlocker, "2 lines haven't been sent to the kitchen. Send or remove them first.");
});

test("not served is a warning, not a blocker", () => {
  const summary = summariseBill([line(1, "10", "PENDING"), line(1, "10", "PREPARING"), line(1, "10", "SERVED")], "0");
  assert.equal(summary.notServed, 2);
  assert.equal(summary.settleBlocker, null);
  assert.equal(money(summary).total, "30.00");
});

test("nothing billed: nothing to settle", () => {
  assert.equal(summariseBill([], "10").settleBlocker, "Nothing to bill yet.");
  assert.equal(summariseBill([line(1, "10", "SERVED", { cancelledAt: new Date() })], "10").settleBlocker, "Nothing to bill yet.");
  assert.equal(money(summariseBill([], "10")).total, "0.00");
});
