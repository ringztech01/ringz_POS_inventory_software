// Run with: npx tsx --test modules/restaurant/__tests__/tender.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { quickCash, tender, type Tender, type TenderRow } from "../lib/tender";
import { settleSchema } from "../schemas/bill";

const pay = (paymentType: TenderRow["paymentType"], amount: string): TenderRow => ({ paymentType, amount });
const show = (t: Tender) =>
  t.ok
    ? {
        collected: t.collected.toFixed(2),
        change: t.change.toFixed(2),
        payments: t.payments.map((p) => [p.paymentType, p.amount.toFixed(2)]),
        tips: t.tips.map((p) => [p.paymentType, p.amount.toFixed(2)]),
      }
    : { error: t.error, short: t.short.toFixed(2) };

test("cash: exact, and with change", () => {
  assert.deepEqual(show(tender("41.23", "0", [pay("CASH", "41.23")])), { collected: "41.23", change: "0.00", payments: [["CASH", "41.23"]], tips: [] });
  assert.deepEqual(show(tender("41.23", "0", [pay("CASH", "50")])), { collected: "50.00", change: "8.77", payments: [["CASH", "41.23"]], tips: [] });
});

test("not enough: how much is still due", () => {
  assert.deepEqual(show(tender("41.23", "0", [pay("CASH", "40")])), { error: "₦1.23 still to pay.", short: "1.23" });
  assert.deepEqual(show(tender("41.23", "5", [pay("CARD", "41.23")])), { error: "₦5.00 still to pay.", short: "5.00" });
});

test("several methods: card and transfer exact, change only out of the cash", () => {
  assert.deepEqual(show(tender("100", "0", [pay("CARD", "60"), pay("CASH", "50")])), {
    collected: "110.00",
    change: "10.00",
    payments: [
      ["CARD", "60.00"],
      ["CASH", "40.00"],
    ],
    tips: [],
  });
  assert.deepEqual(show(tender("100", "0", [pay("CARD", "60"), pay("BANK_TRANSFER", "40")])), {
    collected: "100.00",
    change: "0.00",
    payments: [
      ["CARD", "60.00"],
      ["BANK_TRANSFER", "40.00"],
    ],
    tips: [],
  });
  const over = tender("100", "0", [pay("CARD", "70"), pay("BANK_TRANSFER", "40")]);
  assert.equal(show(over).error, "Card, transfer and cheque come to ₦110.00, more than the ₦100.00 owed. Change only comes from cash.");
  assert.equal(show(tender("100", "0", [pay("CASH", "50"), pay("CASH", "50")])).error, "Use each payment method once.");
});

test("the tip: kept apart from the sale's payments, from the last method first", () => {
  // ₦41.23 + ₦5 tip, all on card.
  assert.deepEqual(show(tender("41.23", "5", [pay("CARD", "46.23")])), { collected: "46.23", change: "0.00", payments: [["CARD", "41.23"]], tips: [["CARD", "5.00"]] });
  // Cash for most of it, the tip and the rest on card.
  assert.deepEqual(show(tender("41.23", "5", [pay("CASH", "40"), pay("CARD", "6.23")])), {
    collected: "46.23",
    change: "0.00",
    payments: [
      ["CASH", "40.00"],
      ["CARD", "1.23"],
    ],
    tips: [["CARD", "5.00"]],
  });
  // A tip bigger than the last method spills onto the one before.
  assert.deepEqual(show(tender("10", "8", [pay("CASH", "15"), pay("CARD", "3")])).tips, [
    ["CASH", "5.00"],
    ["CARD", "3.00"],
  ]);
  // Cash with change and a tip: the change is what's left after bill + tip.
  assert.deepEqual(show(tender("41.23", "5", [pay("CASH", "50")])), { collected: "50.00", change: "3.77", payments: [["CASH", "41.23"]], tips: [["CASH", "5.00"]] });
});

test("payments always add up to the amount due, tips to the tip", () => {
  const cases: [string, string, TenderRow[]][] = [
    ["17.11", "0", [pay("CASH", "20")]],
    ["17.13", "2.5", [pay("CARD", "10"), pay("CASH", "100")]],
    ["99.99", "0.01", [pay("CHEQUE", "50"), pay("BANK_TRANSFER", "30"), pay("CASH", "20.00")]],
  ];
  for (const [due, tip, rows] of cases) {
    const t = tender(due, tip, rows);
    assert.ok(t.ok, due);
    assert.equal(t.payments.reduce((s, p) => s.plus(p.amount), t.collected.minus(t.collected)).toFixed(2), Number(due).toFixed(2));
    assert.equal(t.tips.reduce((s, p) => s.plus(p.amount), t.collected.minus(t.collected)).toFixed(2), Number(tip).toFixed(2));
  }
});

test("nothing owed (a ₦0 part): no payment needed", () => {
  assert.deepEqual(show(tender("0", "0", [])), { collected: "0.00", change: "0.00", payments: [], tips: [] });
  assert.equal(show(tender("0", "0", [pay("CASH", "-1")])).error, "Amounts can't be below ₦0.00.");
});

test("quick cash: the next round amounts above what's left", () => {
  assert.deepEqual(quickCash("41.23").map((d) => d.toFixed(0)), ["500", "1000", "5000", "10000"]);
  assert.deepEqual(quickCash("1250").map((d) => d.toFixed(0)), ["1500", "2000", "5000", "10000"]);
  // Already round at ₦500/₦1,000/₦5,000 (Exact covers that): only ₦10,000 is above it.
  assert.deepEqual(quickCash("5000").map((d) => d.toFixed(0)), ["10000"]);
  assert.deepEqual(quickCash("4900").map((d) => d.toFixed(0)), ["5000", "10000"]);
  assert.deepEqual(quickCash("0"), []);
});

test("the settle schema: what was handed over, never what's due", () => {
  const base = { orderId: "o1", version: 3, payments: [{ paymentType: "CASH", amount: "50" }], idempotencyKey: "4a7f3c2e-1b9d-4c8a-9e2f-0a1b2c3d4e5f" };
  assert.deepEqual(settleSchema.parse(base).tip, "0");
  assert.equal(settleSchema.safeParse({ ...base, idempotencyKey: "abc" }).success, false);
  assert.equal(settleSchema.safeParse({ ...base, payments: [{ paymentType: "MOBILE_MONEY", amount: "5" }] }).success, false);
  assert.equal(settleSchema.safeParse({ ...base, tip: "-1" }).success, false);
  assert.equal(settleSchema.safeParse({ ...base, payments: Array(5).fill({ paymentType: "CASH", amount: "1" }) }).success, false);
  const parsed = settleSchema.parse({ ...base, due: "0.01", amountDue: "1", total: "1" });
  assert.deepEqual(Object.keys(parsed).sort(), ["idempotencyKey", "orderId", "payments", "tip", "version"]);
});
