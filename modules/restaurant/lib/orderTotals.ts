import type { OrderDiscountType, TaxType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { computeLine, computeOrder, sumSubtotals } from "@/lib/pricing";

// An order's money, from its lines' snapshots, through lib/pricing.ts only —
// the same maths as Sales. Called on the server; the browser is only ever
// sent the results.
//
//   Sub total       the lines before tax (each: snapshot price × quantity)
//   Discount        the order's discount: a % of the sub total, or an
//                   amount — never more than the sub total
//   Service charge  BusinessSetting.restaurantServiceChargePercent of the sub
//                   total after the discount (what the guest is paying
//                   for) — worked out as an order-level percentage; nothing
//                   while the order's service charge is switched off
//   Tax             each line's own tax (its product's rate, snapshotted);
//                   the discount comes off the total, as on a retail sale,
//                   so it doesn't change the tax
//   Total           lines with their tax, less the discount, plus the
//                   service charge
//
// When the order is billed the Sale gets the same lines, the discount as
// its order discount and the service charge as its (untaxed) shipping
// amount, so its grand total is this total.

export type PricedLine = {
  quantity: number;
  // The snapshot price per unit, modifiers included.
  unitPrice: Decimal.Value;
  taxType: TaxType;
  taxRate: Decimal.Value;
  cancelledAt: Date | null;
  deletedAt: Date | null;
};

// The order's own adjustments (Order.discountType / discountValue /
// serviceCharge). Left out: no discount, service charge on.
export type OrderAdjustments = {
  discountType?: OrderDiscountType | null;
  discountValue?: Decimal.Value;
  serviceCharge?: boolean;
};

export type OrderTotals = {
  subTotal: Decimal;
  discount: Decimal;
  serviceCharge: Decimal;
  tax: Decimal;
  total: Decimal;
  // The tax rates (%) on the counted lines, e.g. ["7.5"] — for the label.
  taxRates: string[];
};

// Cancelled and removed lines stay on the ticket but don't count.
export function countsTowardsTotal(line: Pick<PricedLine, "cancelledAt" | "deletedAt">): boolean {
  return !line.cancelledAt && !line.deletedAt;
}

function price(line: PricedLine) {
  return computeLine({
    unitCost: line.unitPrice,
    quantity: line.quantity,
    discountType: "FIXED",
    discount: 0,
    taxType: line.taxType,
    taxRate: line.taxRate,
  });
}

// A line's unit price: the dish's price plus its chosen options' price
// changes, snapshotted on the line when it's added.
export function linePrice(dishPrice: Decimal.Value, optionPrices: readonly Decimal.Value[]): Decimal {
  return sumSubtotals([dishPrice, ...optionPrices]);
}

// One line before tax — what the ticket shows against it. The ticket's
// lines add up to its Sub total.
export function lineAmount(line: PricedLine): Decimal {
  const priced = price(line);
  return priced.subtotal.minus(priced.taxAmount);
}

// The discount in Naira on a sub total: a % of it (rounded to kobo) or the
// amount — capped at the sub total either way.
export function discountAmount(subTotal: Decimal.Value, type: OrderDiscountType | null | undefined, value: Decimal.Value = 0): Decimal {
  const base = new Decimal(subTotal);
  if (!type) return new Decimal(0);
  const raw = type === "PERCENT" ? base.times(value).div(100) : new Decimal(value);
  return Decimal.min(raw.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), base);
}

export function orderTotals(lines: readonly PricedLine[], servicePercent: Decimal.Value, adjustments: OrderAdjustments = {}): OrderTotals {
  const counted = lines.filter(countsTowardsTotal);
  const priced = counted.map(price);
  const itemsTotal = sumSubtotals(priced.map((p) => p.subtotal));
  const tax = sumSubtotals(priced.map((p) => p.taxAmount));
  const subTotal = itemsTotal.minus(tax);
  const discount = discountAmount(subTotal, adjustments.discountType, adjustments.discountValue);
  const serviceCharge =
    adjustments.serviceCharge === false
      ? new Decimal(0)
      : computeOrder({ itemsTotal: subTotal.minus(discount), taxRate: servicePercent, discount: 0, shipping: 0 }).orderTaxAmount;
  const total = computeOrder({ itemsTotal, taxRate: 0, discount, shipping: serviceCharge }).grandTotal;
  const taxRates = [...new Set(counted.map((l) => new Decimal(l.taxRate).toString()).filter((rate) => rate !== "0"))];
  return { subTotal, discount, serviceCharge, tax, total, taxRates };
}
