// Run with: npx tsx --test lib/payments.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computePaymentState } from "./payments";

const pay = (amount: string, paymentType: "CASH" | "CARD" | "BANK_TRANSFER" | "CHEQUE", date: string, createdAt?: string) => ({
  amount,
  paymentType,
  date: new Date(date),
  ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
});

function state(grandTotal: string, payments: ReturnType<typeof pay>[]) {
  const r = computePaymentState(grandTotal, payments);
  return { paid: r.paid.toFixed(2), due: r.due.toFixed(2), status: r.paymentStatus, type: r.paymentType };
}

describe("computePaymentState", () => {
  test("no payments → Unpaid, due = grand total, no type", () => {
    assert.deepEqual(state("1500.00", []), { paid: "0.00", due: "1500.00", status: "UNPAID", type: null });
  });

  test("part payment → Partial", () => {
    assert.deepEqual(state("1500.00", [pay("500", "CASH", "2026-10-01")]), {
      paid: "500.00",
      due: "1000.00",
      status: "PARTIAL",
      type: "CASH",
    });
  });

  test("payments summing exactly to the total → Paid, due 0", () => {
    const r = state("1500.00", [pay("1000", "CASH", "2026-10-01"), pay("500", "CARD", "2026-10-02")]);
    assert.equal(r.paid, "1500.00");
    assert.equal(r.due, "0.00");
    assert.equal(r.status, "PAID");
  });

  test("Decimal-exact: 0.10 + 0.20 pays a 0.30 total", () => {
    assert.equal(state("0.30", [pay("0.10", "CASH", "2026-10-01"), pay("0.20", "CASH", "2026-10-01")]).status, "PAID");
  });

  test("overpayment is still Paid and due never goes negative", () => {
    const r = state("100.00", [pay("150", "CASH", "2026-10-01")]);
    assert.equal(r.status, "PAID");
    assert.equal(r.due, "0.00");
  });

  test("a ₦0 sale counts as Paid (nothing owed)", () => {
    assert.equal(state("0.00", []).status, "PAID");
  });

  test("paymentType is the latest payment's type (by date, then creation time)", () => {
    assert.equal(
      state("900", [pay("100", "CARD", "2026-10-03"), pay("100", "CASH", "2026-10-01"), pay("100", "CHEQUE", "2026-10-02")]).type,
      "CARD",
    );
    assert.equal(
      state("900", [
        pay("100", "CASH", "2026-10-03", "2026-10-03T09:00:00Z"),
        pay("100", "BANK_TRANSFER", "2026-10-03", "2026-10-03T10:00:00Z"),
      ]).type,
      "BANK_TRANSFER",
    );
  });
});
