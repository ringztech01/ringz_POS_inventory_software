// Run with: npx tsx --test modules/restaurant/__tests__/refund.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { planRefund, type RefundSale, type RefundSaleLine } from "../lib/refund";
import { refundSchema } from "../schemas/bill";

const line = (saleItemId: string, sold: number, unitCost: string, extra: Partial<RefundSaleLine> = {}): RefundSaleLine => ({
  saleItemId,
  name: saleItemId,
  sold,
  returned: 0,
  unitCost,
  discountType: "FIXED",
  discount: "0",
  taxType: "EXCLUSIVE",
  taxRate: "0",
  saleUnit: "Pic",
  ...extra,
});
// The settled bill's sale: 2× Jollof ₦18, 1× Chapman ₦10 + 7.5% → items ₦46.75;
// a ₦4.60 discount and ₦4.14 service charge → ₦46.29.
const lines = [line("jollof", 2, "18.00"), line("chapman", 1, "10.00", { taxRate: "7.5" })];
const sale: RefundSale = { itemsTotal: "46.75", discount: "4.60", shipping: "4.14", refundedDiscount: "0", refundedShipping: "0" };
const show = (p: ReturnType<typeof planRefund>) =>
  p.ok ? { items: p.items.map((i) => [i.saleItemId, i.quantity]), itemsTotal: p.itemsTotal.toFixed(2), discount: p.discount.toFixed(2), shipping: p.shipping.toFixed(2), total: p.total.toFixed(2) } : p.error;

test("one dish: priced as on the sale, with its share of the discount and service charge", () => {
  // ₦18 of ₦46.75: discount 4.60 × 18/46.75 = 1.77; service 4.14 × 18/46.75 = 1.59.
  assert.deepEqual(show(planRefund(sale, lines, [{ saleItemId: "jollof", quantity: 1 }])), { items: [["jollof", 1]], itemsTotal: "18.00", discount: "1.77", shipping: "1.59", total: "17.82" });
  // The Chapman with its tax.
  const chapman = planRefund(sale, lines, [{ saleItemId: "chapman", quantity: 1 }]);
  assert.ok(chapman.ok);
  assert.equal(chapman.itemsTotal.toFixed(2), "10.75");
});

test("everything at once: exactly the sale's total", () => {
  const all = planRefund(sale, lines, [{ saleItemId: "jollof", quantity: 2 }, { saleItemId: "chapman", quantity: 1 }]);
  assert.deepEqual(show(all), { items: [["jollof", 2], ["chapman", 1]], itemsTotal: "46.75", discount: "4.60", shipping: "4.14", total: "46.29" });
});

test("refunds one by one add up to the sale exactly: the last takes what's left", () => {
  let state = { sale: { ...sale }, lines: lines.map((l) => ({ ...l })) };
  let refunded = new Decimal(0);
  for (const pick of [{ saleItemId: "jollof", quantity: 1 }, { saleItemId: "chapman", quantity: 1 }, { saleItemId: "jollof", quantity: 1 }]) {
    const plan = planRefund(state.sale, state.lines, [pick]);
    assert.ok(plan.ok);
    refunded = refunded.plus(plan.total);
    state = {
      sale: { ...state.sale, refundedDiscount: new Decimal(state.sale.refundedDiscount).plus(plan.discount).toFixed(2), refundedShipping: new Decimal(state.sale.refundedShipping).plus(plan.shipping).toFixed(2) },
      lines: state.lines.map((l) => (l.saleItemId === pick.saleItemId ? { ...l, returned: l.returned + pick.quantity } : l)),
    };
  }
  assert.equal(refunded.toFixed(2), "46.29");
  assert.deepEqual([state.sale.refundedDiscount, state.sale.refundedShipping], ["4.60", "4.14"]);
});

test("a sale with no discount or service charge: just the dishes", () => {
  const plain = { ...sale, discount: "0", shipping: "0" };
  assert.deepEqual(show(planRefund(plain, lines, [{ saleItemId: "jollof", quantity: 2 }])), { items: [["jollof", 2]], itemsTotal: "36.00", discount: "0.00", shipping: "0.00", total: "36.00" });
});

test("refused: nothing chosen, more than is left, a dish not on the sale, the same dish twice", () => {
  assert.equal(show(planRefund(sale, lines, [])), "Choose what to refund.");
  assert.equal(show(planRefund(sale, lines, [{ saleItemId: "jollof", quantity: 0 }])), "Choose what to refund.");
  assert.equal(show(planRefund(sale, [line("jollof", 2, "18", { returned: 1 }), lines[1]], [{ saleItemId: "jollof", quantity: 2 }])), "Only 1 × jollof left to refund.");
  assert.equal(show(planRefund(sale, lines, [{ saleItemId: "suya", quantity: 1 }])), "A dish isn't on this bill's sale any more. Close and try again.");
  assert.equal(show(planRefund(sale, lines, [{ saleItemId: "jollof", quantity: 1 }, { saleItemId: "jollof", quantity: 1 }])), "Each dish once.");
});

test("the refund schema", () => {
  const base = { orderId: "o1", lines: [{ saleItemId: "s1", quantity: 1 }], returnToStock: true, paymentType: "CASH", reason: "Cold", idempotencyKey: "4a7f3c2e-1b9d-4c8a-9e2f-0a1b2c3d4e5f" };
  assert.ok(refundSchema.safeParse(base).success);
  const issue = (input: object) => refundSchema.safeParse({ ...base, ...input }).error?.issues[0]?.message;
  assert.equal(issue({ reason: "  " }), "Give a reason for the refund.");
  assert.equal(issue({ lines: [] }), "Choose what to refund.");
  assert.equal(refundSchema.safeParse({ ...base, lines: [{ saleItemId: "s1", quantity: 1.5 }] }).success, false);
  assert.equal(refundSchema.safeParse({ ...base, returnToStock: "yes" }).success, false);
  // No amounts from the browser.
  assert.deepEqual(Object.keys(refundSchema.parse({ ...base, amount: "999" })).sort(), ["idempotencyKey", "lines", "orderId", "paymentType", "reason", "returnToStock"]);
});
