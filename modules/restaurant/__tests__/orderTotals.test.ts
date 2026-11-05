// Run with: npx tsx --test modules/restaurant/__tests__/orderTotals.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineAmount, orderTotals, type PricedLine } from "../lib/orderTotals";
import { formatOpenFor } from "../lib/time";

const line = (quantity: number, unitPrice: string, extra: Partial<PricedLine> = {}): PricedLine => ({
  quantity,
  unitPrice,
  taxType: "EXCLUSIVE",
  taxRate: "0",
  cancelledAt: null,
  deletedAt: null,
  ...extra,
});
const fixed = (t: ReturnType<typeof orderTotals>) => ({
  subTotal: t.subTotal.toFixed(2),
  serviceCharge: t.serviceCharge.toFixed(2),
  tax: t.tax.toFixed(2),
  total: t.total.toFixed(2),
  taxRates: t.taxRates,
});

test("a line's amount is before tax: snapshot price × quantity", () => {
  assert.equal(lineAmount(line(2, "18.00")).toFixed(2), "36.00");
  assert.equal(lineAmount(line(1, "10.00", { taxRate: "7.5" })).toFixed(2), "10.00");
  // Tax-inclusive price: the tax part comes out of it.
  assert.equal(lineAmount(line(1, "10.75", { taxType: "INCLUSIVE", taxRate: "7.5" })).toFixed(2), "10.00");
});

test("sub total, service charge, tax and total (lib/pricing)", () => {
  const lines = [line(2, "18.00"), line(1, "10.00", { taxRate: "7.5" })];
  assert.deepEqual(fixed(orderTotals(lines, "10")), { subTotal: "46.00", serviceCharge: "4.60", tax: "0.75", total: "51.35", taxRates: ["7.5"] });
  assert.deepEqual(fixed(orderTotals(lines, "0")), { subTotal: "46.00", serviceCharge: "0.00", tax: "0.75", total: "46.75", taxRates: ["7.5"] });
  assert.deepEqual(fixed(orderTotals(lines, "12.5")).serviceCharge, "5.75");
});

test("the lines shown add up to the sub total", () => {
  const lines = [line(3, "6.00"), line(1, "10.75", { taxType: "INCLUSIVE", taxRate: "7.5" }), line(2, "4.10", { taxRate: "7.5" })];
  const shown = lines.reduce((sum, l) => sum + Number(lineAmount(l).toFixed(2)), 0);
  assert.equal(shown.toFixed(2), orderTotals(lines, "10").subTotal.toFixed(2));
});

test("cancelled and removed lines are left out of every total", () => {
  const lines = [
    line(2, "18.00"),
    line(1, "26.00"),
    line(3, "6.00", { cancelledAt: new Date() }),
    line(1, "99.00", { deletedAt: new Date() }),
  ];
  assert.deepEqual(fixed(orderTotals(lines, "10")), { subTotal: "62.00", serviceCharge: "6.20", tax: "0.00", total: "68.20", taxRates: [] });
  assert.deepEqual(fixed(orderTotals([], "10")), { subTotal: "0.00", serviceCharge: "0.00", tax: "0.00", total: "0.00", taxRates: [] });
});

test("time open", () => {
  assert.deepEqual([0, 6, 59, 60, 72, 125].map(formatOpenFor), ["0m", "6m", "59m", "1h 0m", "1h 12m", "2h 5m"]);
});
