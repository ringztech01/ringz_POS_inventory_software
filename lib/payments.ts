import type { PaymentStatus, PaymentType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { toDecimal } from "@/lib/pricing";

// The single source of a sale's payment figures. Sale.paid / due /
// paymentStatus / paymentType are never typed in: every write (create, add or
// delete a payment, edit, delete) recomputes them with this from the sale's
// active SalePayment rows and its grand total. Pure and client-safe, so the
// create form's live status pill uses it too.

export type PaymentLike = {
  amount: Decimal.Value;
  paymentType: PaymentType;
  date: Date;
  createdAt?: Date;
};

export type PaymentState = {
  paid: Decimal;
  // grandTotal − paid, never below zero.
  due: Decimal;
  // paid ≥ grandTotal → PAID (incl. a ₦0 total); paid = 0 → UNPAID; else PARTIAL.
  paymentStatus: PaymentStatus;
  // Type of the latest payment (by date, then creation time); null if none.
  paymentType: PaymentType | null;
};

export function computePaymentState(grandTotal: Decimal.Value, payments: PaymentLike[]): PaymentState {
  const total = toDecimal(grandTotal);
  const paid = payments
    .reduce<Decimal>((sum, payment) => sum.plus(toDecimal(payment.amount)), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const paymentStatus: PaymentStatus = paid.greaterThanOrEqualTo(total) ? "PAID" : paid.isZero() ? "UNPAID" : "PARTIAL";

  const latest = [...payments].sort(
    (a, b) =>
      b.date.getTime() - a.date.getTime() || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
  )[0];

  return {
    paid,
    due: Decimal.max(total.minus(paid), 0),
    paymentStatus,
    paymentType: latest?.paymentType ?? null,
  };
}
