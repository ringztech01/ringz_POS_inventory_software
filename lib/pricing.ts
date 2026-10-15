// Shared line/order pricing for Purchases (and later Sales). The create/edit
// form uses this for live totals and the server action re-runs it on save,
// so the numbers the user sees and the numbers stored are computed by the same
// code. Never inline this math elsewhere.
//
// Decimal comes from Prisma's browser runtime: it's the same decimal.js build
// Prisma uses for Decimal columns, and it's safe to bundle into client
// components (unlike `@prisma/client` itself).
//
// Rounding: every returned money value is rounded half-up to 2dp. Where a
// per-unit value feeds a line total, the line total is computed from the
// unrounded per-unit value and rounded once, so quantity doesn't multiply
// rounding error (see the inclusive-tax test cases).
//
// Inputs are deliberately forgiving — "" / null / unparseable / negative all
// count as 0 — because the form calls this on every keystroke. Rejecting bad
// input is zod's job in the server action, not this module's.
import { Decimal } from "@prisma/client/runtime/index-browser";

export type LineDiscountType = "FIXED" | "PERCENTAGE";
export type LineTaxType = "INCLUSIVE" | "EXCLUSIVE";

type Value = Decimal.Value | null | undefined;

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

export function toDecimal(value: Value): Decimal {
  if (value === null || value === undefined) return ZERO;
  if (typeof value === "string" && value.trim() === "") return ZERO;
  let d: Decimal;
  try {
    d = new Decimal(typeof value === "string" ? value.trim() : value);
  } catch {
    return ZERO;
  }
  if (!d.isFinite() || d.isNegative()) return ZERO;
  return d;
}

function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export type LineInput = {
  unitCost: Value;
  quantity: Value;
  discountType: LineDiscountType;
  // FIXED: Naira off each unit. PERCENTAGE: % off the unit cost.
  discount: Value;
  taxType: LineTaxType;
  // Percentage, e.g. "7.5" for 7.5%.
  taxRate: Value;
};

export type LineResult = {
  // The unit cost as entered.
  unitCost: Decimal;
  discountPerUnit: Decimal;
  discountAmount: Decimal;
  // Per-unit cost after discount, excluding tax.
  netUnitCost: Decimal;
  taxPerUnit: Decimal;
  taxAmount: Decimal;
  subtotal: Decimal;
};

// Discount is applied to the unit cost first, then tax:
// - EXCLUSIVE: tax is added on top of the discounted price.
// - INCLUSIVE: the discounted price already contains the tax, which is
//   extracted as price − price / (1 + rate).
// A discount larger than the unit cost is capped at the unit cost.
export function computeLine(input: LineInput): LineResult {
  const unitCost = round2(toDecimal(input.unitCost));
  const quantity = toDecimal(input.quantity);
  const rate = toDecimal(input.taxRate).div(HUNDRED);

  const rawDiscount =
    input.discountType === "PERCENTAGE"
      ? unitCost.times(toDecimal(input.discount)).div(HUNDRED)
      : toDecimal(input.discount);
  // The discounted unit price is a money amount, so it's rounded here; the
  // per-unit discount is then derived from it so the two always add up.
  const price = round2(unitCost.minus(Decimal.min(rawDiscount, unitCost)));
  const discountPerUnit = unitCost.minus(price);

  const net = input.taxType === "INCLUSIVE" ? price.div(rate.plus(1)) : price;
  const taxPerUnit = input.taxType === "INCLUSIVE" ? price.minus(net) : price.times(rate);

  const linePrice = round2(price.times(quantity));
  const taxAmount = round2(taxPerUnit.times(quantity));
  const subtotal = input.taxType === "INCLUSIVE" ? linePrice : linePrice.plus(taxAmount);

  return {
    unitCost,
    discountPerUnit,
    discountAmount: round2(discountPerUnit.times(quantity)),
    netUnitCost: round2(net),
    taxPerUnit: round2(taxPerUnit),
    taxAmount,
    subtotal,
  };
}

export function sumSubtotals(subtotals: Value[]): Decimal {
  return round2(subtotals.reduce<Decimal>((sum, s) => sum.plus(toDecimal(s)), ZERO));
}

export type OrderInput = {
  // Sum of line subtotals — see sumSubtotals.
  itemsTotal: Value;
  // Order tax percentage.
  taxRate: Value;
  // Fixed Naira amount off the order.
  discount: Value;
  shipping: Value;
};

export type OrderResult = {
  itemsTotal: Decimal;
  taxRate: Decimal;
  orderTaxAmount: Decimal;
  discount: Decimal;
  shipping: Decimal;
  grandTotal: Decimal;
};

// grandTotal = (items − discount) + order tax on (items − discount) + shipping.
// Shipping is not taxed. A discount larger than the items total is capped.
export function computeOrder(input: OrderInput): OrderResult {
  const itemsTotal = round2(toDecimal(input.itemsTotal));
  const taxRate = toDecimal(input.taxRate);
  const discount = Decimal.min(round2(toDecimal(input.discount)), itemsTotal);
  const shipping = round2(toDecimal(input.shipping));

  const taxable = itemsTotal.minus(discount);
  const orderTaxAmount = round2(taxable.times(taxRate).div(HUNDRED));

  return {
    itemsTotal,
    taxRate,
    orderTaxAmount,
    discount,
    shipping,
    grandTotal: taxable.plus(orderTaxAmount).plus(shipping),
  };
}
