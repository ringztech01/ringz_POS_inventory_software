import type { KitchenStatus, OrderType, PaymentType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import type { z } from "zod";
import { computeLine, computeOrder, sumSubtotals } from "@/lib/pricing";
import type { PurchaseUnit } from "@/lib/purchase-units";
import type { salePaymentSchema, saleSchema } from "@/lib/validations/sale";
import { isBilled } from "./bill";
import { ORDER_TYPE_LABEL } from "./orderLines";
import { orderTotals, type OrderAdjustments, type PricedLine } from "./orderTotals";

// orderToSale: an order's bill → exactly what retail's createSale takes
// (saleSchema's input), so settling goes through the one sale-saving path
// instead of a fork. Pure: the caller loads the order and passes today's
// date, the walk-in customer and the payment being taken.
//
// Lines — the billed ones only (sent, not cancelled/VOID, not removed):
//
//   Modifier price changes are part of the line's unit price — the price
//   snapshotted on the order line, which already includes them — never sale
//   lines of their own. A modifier isn't a product: a sale line needs one,
//   and stock and the product reports go by product. A "No rice −₦2" option
//   would be a negative line. And it's the price the guest saw on the ticket
//   and the bill. The options themselves stay on the order's lines (the
//   Sale links to its Order).
//
//   Retail lists each product once per sale, so the same dish on several
//   order lines (different options or notes) becomes one sale line: the
//   quantities added up, priced at their average — rounded up to the kobo
//   when it isn't exact — with the newest line's tax.
//
// Order-level: the discount as the sale's discount, the service charge as
// its (untaxed) shipping, no order tax (tax is per line). The sale is then
// priced here with lib/pricing.ts exactly as the server will; any kobo it
// differs from the bill (an averaged price, tax rounding on a combined
// line) goes on the discount (sale higher) or the shipping (sale lower), so
// the sale's grand total is the bill total to the kobo.
//
// Payments: createSale takes one (paidAmount + paymentType); further
// methods come back as sale payments to add in the same transaction. The
// sale notes carry the order reference, table, order type and waiter.

export const SALE_UNIT: PurchaseUnit = "Pic"; // as the POS till

export type OrderForSale = OrderAdjustments & {
  ref: string;
  table: string | null;
  waiter: string | null;
  type: OrderType;
  warehouseId: string;
  customerId: string | null;
  lines: (PricedLine & { productId: string; kitchenStatus: KitchenStatus })[];
};

export type PaymentIn = { paymentType: PaymentType; amount: Decimal.Value };
export type SaleInput = z.input<typeof saleSchema>;
export type SalePaymentInput = z.input<typeof salePaymentSchema>;

export type SaleFromOrder =
  | {
      ok: true;
      input: SaleInput;
      // The second method on (createSale takes the first).
      morePayments: SalePaymentInput[];
      // The sale's grand total as retail will work it out: the bill total.
      grandTotal: Decimal;
      // What the kobo rounding put on the discount (+) or shipping (−).
      rounding: Decimal;
    }
  | { ok: false; error: string };

const two = (value: Decimal) => value.toFixed(2);

// "Restaurant ORD-0073 · Table CB1 · Dine-in · Waiter: Ada"
export function saleNotes(order: Pick<OrderForSale, "ref" | "table" | "type" | "waiter">): string {
  return [`Restaurant ${order.ref}`, order.table ? `Table ${order.table}` : null, ORDER_TYPE_LABEL[order.type], `Waiter: ${order.waiter ?? "—"}`]
    .filter(Boolean)
    .join(" · ");
}

// Payments as sale payments (a later part of a split bill, or the methods
// after the first): on `date`, noted with the order (and part).
export function toSalePayments(payments: readonly PaymentIn[], date: string, note: string): SalePaymentInput[] {
  return payments
    .map((p) => ({ paymentType: p.paymentType, amount: new Decimal(p.amount) }))
    .filter((p) => p.amount.greaterThan(0))
    .map((p) => ({ amount: two(p.amount), paymentType: p.paymentType, date, notes: note }));
}

export function orderToSale(
  order: OrderForSale,
  options: {
    servicePercent: Decimal.Value;
    // The payment being taken now: the whole bill, or the first part paid of
    // a split bill (the sale is made then; later parts add payments).
    payments: readonly PaymentIn[];
    // "YYYY-MM-DD", today on the app calendar.
    date: string;
    // The protected walk-in customer, for an order without a customer.
    walkInCustomerId: string;
    // On each payment's notes, e.g. "1 of 3" for a split bill's part.
    paymentNote?: string;
  },
): SaleFromOrder {
  const billed = order.lines.filter(isBilled);
  if (billed.length === 0) return { ok: false, error: "Nothing to bill yet." };
  const bill = orderTotals(billed, options.servicePercent, order);

  // One sale line per dish, in the order the dishes first appear.
  const byProduct = new Map<string, typeof billed>();
  for (const line of billed) byProduct.set(line.productId, [...(byProduct.get(line.productId) ?? []), line]);
  const items = [...byProduct].map(([productId, lines]) => {
    const quantity = lines.reduce((n, l) => n + l.quantity, 0);
    const entered = sumSubtotals(lines.map((l) => new Decimal(l.unitPrice).times(l.quantity)));
    const newest = lines[lines.length - 1];
    return {
      productId,
      quantity,
      unitCost: two(entered.div(quantity).toDecimalPlaces(2, Decimal.ROUND_UP)),
      discountType: "FIXED" as const,
      discount: "0",
      taxType: newest.taxType,
      taxRate: new Decimal(newest.taxRate).toString(),
      purchaseUnit: SALE_UNIT,
    };
  });

  // Priced as the server will (loadDocument → computeLine / computeOrder).
  const itemsTotal = sumSubtotals(items.map((item) => computeLine(item).subtotal));
  const asIs = computeOrder({ itemsTotal, taxRate: 0, discount: bill.discount, shipping: bill.serviceCharge }).grandTotal;
  const rounding = asIs.minus(bill.total);
  const discount = rounding.greaterThan(0) ? bill.discount.plus(rounding) : bill.discount;
  const shipping = rounding.lessThan(0) ? bill.serviceCharge.minus(rounding) : bill.serviceCharge;
  const grandTotal = computeOrder({ itemsTotal, taxRate: 0, discount, shipping }).grandTotal;
  if (!grandTotal.equals(bill.total) || discount.greaterThan(itemsTotal)) {
    return { ok: false, error: "This bill can't be turned into a sale exactly. Please report it." };
  }

  const paid = options.payments.map((p) => ({ paymentType: p.paymentType, amount: new Decimal(p.amount) })).filter((p) => p.amount.greaterThan(0));
  if (paid.some((p) => p.amount.decimalPlaces() > 2)) return { ok: false, error: "Payments are in Naira and kobo." };
  if (sumSubtotals(paid.map((p) => p.amount)).greaterThan(grandTotal)) return { ok: false, error: "The payment is more than the bill." };
  const [first, ...rest] = paid;
  const note = [`Restaurant ${order.ref}`, options.paymentNote].filter(Boolean).join(" · ");

  return {
    ok: true,
    input: {
      date: options.date,
      status: "RECEIVED",
      warehouseId: order.warehouseId,
      customerId: order.customerId ?? options.walkInCustomerId,
      orderTax: "0",
      discount: two(discount),
      shipping: two(shipping),
      notes: saleNotes(order),
      paidAmount: first ? two(first.amount) : "0",
      paymentType: first?.paymentType ?? "CASH",
      items,
    },
    morePayments: toSalePayments(rest, options.date, note),
    grandTotal,
    rounding,
  };
}
