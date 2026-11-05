import { Decimal } from "@prisma/client/runtime/index-browser";
import { computeLine, computeOrder, sumSubtotals } from "@/lib/pricing";

// Refunding (part of) a settled bill, as a retail Sale Return against its
// Sale: the dishes picked, priced as on the sale (the sale line's price,
// discount and tax), plus their share of the sale's order-level discount
// and service charge (its shipping), shared out by value. The refund that
// takes back everything still left takes exactly what's left of them, so
// all refunds together never come to more than the sale.
//
// Pure: the Refund pop-up shows its preview with it; the server works it out
// again from the sale itself.

export type RefundSaleLine = {
  saleItemId: string;
  name: string;
  sold: number;
  // Already taken back by earlier returns.
  returned: number;
  unitCost: string;
  discountType: "FIXED" | "PERCENTAGE";
  discount: string;
  taxType: "EXCLUSIVE" | "INCLUSIVE";
  taxRate: string;
  saleUnit: string;
};

export type RefundSale = {
  // The sale line subtotals' sum (with tax), its discount and shipping.
  itemsTotal: string;
  discount: string;
  shipping: string;
  // What earlier returns already took of the discount and shipping.
  refundedDiscount: string;
  refundedShipping: string;
};

export type RefundPick = { saleItemId: string; quantity: number };

export type RefundPlan =
  | {
      ok: true;
      items: { saleItemId: string; quantity: number; unitCost: string; discountType: "FIXED" | "PERCENTAGE"; discount: string; taxType: "EXCLUSIVE" | "INCLUSIVE"; taxRate: string; purchaseUnit: string }[];
      itemsTotal: Decimal;
      discount: Decimal;
      shipping: Decimal;
      total: Decimal;
    }
  | { ok: false; error: string };

const kobo = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function planRefund(sale: RefundSale, lines: readonly RefundSaleLine[], picks: readonly RefundPick[]): RefundPlan {
  const chosen = picks.filter((p) => p.quantity > 0);
  if (chosen.length === 0) return { ok: false, error: "Choose what to refund." };
  const byId = new Map(lines.map((line) => [line.saleItemId, line]));
  if (new Set(chosen.map((p) => p.saleItemId)).size !== chosen.length) return { ok: false, error: "Each dish once." };
  for (const pick of chosen) {
    const line = byId.get(pick.saleItemId);
    if (!line) return { ok: false, error: "A dish isn't on this bill's sale any more. Close and try again." };
    if (!Number.isInteger(pick.quantity)) return { ok: false, error: "Refund whole dishes." };
    const left = line.sold - line.returned;
    if (pick.quantity > left) return { ok: false, error: `Only ${left} × ${line.name} left to refund.` };
  }

  const items = chosen.map((pick) => {
    const line = byId.get(pick.saleItemId)!;
    return {
      saleItemId: line.saleItemId,
      quantity: pick.quantity,
      unitCost: line.unitCost,
      discountType: line.discountType,
      discount: line.discount,
      taxType: line.taxType,
      taxRate: line.taxRate,
      purchaseUnit: line.saleUnit,
    };
  });
  const itemsTotal = sumSubtotals(items.map((item) => computeLine(item).subtotal));

  const discountLeft = new Decimal(sale.discount).minus(sale.refundedDiscount);
  const shippingLeft = new Decimal(sale.shipping).minus(sale.refundedShipping);
  const unitsLeft = lines.reduce((n, line) => n + line.sold - line.returned, 0);
  const everything = chosen.reduce((n, p) => n + p.quantity, 0) === unitsLeft;
  const share = (amount: string, left: Decimal) => {
    if (everything) return Decimal.max(left, 0);
    const all = new Decimal(sale.itemsTotal);
    return all.isZero() ? new Decimal(0) : Decimal.min(kobo(new Decimal(amount).times(itemsTotal).div(all)), Decimal.max(left, 0));
  };
  const discount = Decimal.min(share(sale.discount, discountLeft), itemsTotal);
  const shipping = share(sale.shipping, shippingLeft);
  const total = computeOrder({ itemsTotal, taxRate: 0, discount, shipping }).grandTotal;
  return { ok: true, items, itemsTotal, discount, shipping, total };
}
