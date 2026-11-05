// Run with: npx tsx --test modules/restaurant/__tests__/discount.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDiscount, discountLabel } from "../lib/bill";
import { discountAmount, orderTotals, type PricedLine } from "../lib/orderTotals";
import { approvalPinSchema, orderDiscountSchema } from "../schemas/bill";

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
  discount: t.discount.toFixed(2),
  serviceCharge: t.serviceCharge.toFixed(2),
  tax: t.tax.toFixed(2),
  total: t.total.toFixed(2),
});
// ₦46.00 before tax, ₦0.75 tax.
const lines = [line(2, "18.00"), line(1, "10.00", { taxRate: "7.5" })];

test("no adjustments: the same totals as before (no discount, service charge on)", () => {
  assert.deepEqual(fixed(orderTotals(lines, "10")), { subTotal: "46.00", discount: "0.00", serviceCharge: "4.60", tax: "0.75", total: "51.35" });
});

test("a % discount comes off the sub total; the service charge is on what's left; tax unchanged", () => {
  // 10% of 46 = 4.60; service 10% of 41.40 = 4.14; 46 + 0.75 − 4.60 + 4.14.
  assert.deepEqual(fixed(orderTotals(lines, "10", { discountType: "PERCENT", discountValue: "10" })), {
    subTotal: "46.00",
    discount: "4.60",
    serviceCharge: "4.14",
    tax: "0.75",
    total: "46.29",
  });
});

test("an amount discount, capped at the sub total", () => {
  assert.equal(fixed(orderTotals(lines, "10", { discountType: "AMOUNT", discountValue: "6" })).total, "44.75");
  // More than the sub total: everything before tax is off, so no service charge; the tax is still paid.
  assert.deepEqual(fixed(orderTotals(lines, "10", { discountType: "AMOUNT", discountValue: "500" })), {
    subTotal: "46.00",
    discount: "46.00",
    serviceCharge: "0.00",
    tax: "0.75",
    total: "0.75",
  });
});

test("service charge switched off", () => {
  assert.deepEqual(fixed(orderTotals(lines, "10", { serviceCharge: false })), { subTotal: "46.00", discount: "0.00", serviceCharge: "0.00", tax: "0.75", total: "46.75" });
  assert.equal(fixed(orderTotals(lines, "10", { serviceCharge: false, discountType: "PERCENT", discountValue: "50" })).total, "23.75");
});

test("a % discount rounds to kobo, half up", () => {
  assert.equal(discountAmount("33.33", "PERCENT", "15").toFixed(2), "5.00"); // 4.9995
  assert.equal(discountAmount("10.05", "PERCENT", "50").toFixed(2), "5.03"); // 5.025
  assert.equal(discountAmount("10", null, "50").toFixed(2), "0.00");
});

test("the limit: above it needs an approver; exactly at it doesn't", () => {
  const at = checkDiscount("46", "PERCENT", "10", "10");
  assert.ok(at.ok && !at.needsApproval && at.amount.toFixed(2) === "4.60");
  const over = checkDiscount("46", "PERCENT", "10.5", "10");
  assert.ok(over.ok && over.needsApproval);
  // ₦4.60 of ₦46 is 10% — fine; ₦4.61 is just over.
  const amountAt = checkDiscount("46", "AMOUNT", "4.60", "10");
  assert.ok(amountAt.ok && !amountAt.needsApproval);
  const amountOver = checkDiscount("46", "AMOUNT", "4.61", "10");
  assert.ok(amountOver.ok && amountOver.needsApproval);
  // A limit of 0: every discount needs approval.
  const zero = checkDiscount("46", "PERCENT", "1", "0");
  assert.ok(zero.ok && zero.needsApproval);
});

test("an amount can't be more than the sub total, nor given on an empty bill", () => {
  const tooMuch = checkDiscount("46", "AMOUNT", "46.01", "10");
  assert.ok(!tooMuch.ok && tooMuch.error.includes("₦46.00"));
  const all = checkDiscount("46", "AMOUNT", "46", "100");
  assert.ok(all.ok && all.amount.toFixed(2) === "46.00" && !all.needsApproval);
  const empty = checkDiscount("0", "AMOUNT", "5", "10");
  assert.ok(!empty.ok && empty.error.startsWith("Nothing is billed yet"));
  // A % on an empty bill is allowed (it applies once lines are sent).
  assert.ok(checkDiscount("0", "PERCENT", "5", "10").ok);
});

test("labels", () => {
  assert.equal(discountLabel("PERCENT", "12.50"), "12.5%");
  assert.equal(discountLabel("AMOUNT", "2000"), "₦2,000.00");
});

test("the discount schema", () => {
  const base = { orderId: "o1", version: 3, type: "PERCENT", value: "10", reason: "Regular" };
  assert.ok(orderDiscountSchema.safeParse(base).success);
  const issue = (input: object) => orderDiscountSchema.safeParse(input).error?.issues[0]?.message;
  assert.equal(issue({ ...base, value: "100.01" }), "A percentage can't be more than 100.");
  assert.ok(orderDiscountSchema.safeParse({ ...base, type: "AMOUNT", value: "250000" }).success);
  assert.equal(issue({ ...base, reason: "  " }), "Give a reason for the discount.");
  assert.equal(issue({ ...base, value: "-5" }), "Enter a number like 10 or 2500.50.");
  assert.equal(issue({ ...base, value: "1.234" }), "Enter a number like 10 or 2500.50.");
  // 0 removes the discount: no reason needed.
  assert.ok(orderDiscountSchema.safeParse({ ...base, value: "0", reason: "" }).success);
  assert.equal(issue({ ...base, approval: { approverId: "u1", pin: "12a4" } }), "The PIN is 4 to 6 digits.");
  assert.ok(orderDiscountSchema.safeParse({ ...base, approval: { approverId: "u1", pin: "123456" } }).success);
  // The browser can't send an amount or approver outside `approval`.
  const parsed = orderDiscountSchema.parse({ ...base, amount: "999", discountApprovedById: "x" });
  assert.deepEqual(Object.keys(parsed).sort(), ["orderId", "reason", "type", "value", "version"]);
});

test("the approval PIN schema", () => {
  assert.ok(approvalPinSchema.safeParse({ pin: "4821", confirm: "4821" }).success);
  assert.equal(approvalPinSchema.safeParse({ pin: "4821", confirm: "4812" }).error?.issues[0]?.message, "The two PINs don't match.");
  assert.equal(approvalPinSchema.safeParse({ pin: "123", confirm: "123" }).error?.issues[0]?.message, "The PIN is 4 to 6 digits.");
  assert.equal(approvalPinSchema.safeParse({ pin: "1234567", confirm: "1234567" }).error?.issues[0]?.message, "The PIN is 4 to 6 digits.");
});
