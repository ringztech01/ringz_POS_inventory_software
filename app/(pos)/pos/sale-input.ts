// The thin adapter from a POS checkout to createSale's input (saleSchema) —
// so the till goes through the one sale-saving path (saveNewSale) instead of
// a fork. It only maps fields; saleSchema validates them and the server
// re-prices everything with lib/pricing.ts.
//
// What POS fixes rather than takes from the client:
//   date    today on the app calendar (Africa/Lagos)
//   status  RECEIVED — a till sale hands the goods over now, so stock moves
//   notes   none

export type PosCheckout = {
  customerId: string;
  warehouseId: string;
  orderTax: string;
  discount: string;
  shipping: string;
  // The payment taken now: min(amount received, total) — change is not paid in.
  paidAmount: string;
  paymentType: string;
  lines: {
    productId: string;
    quantity: number;
    unitCost: string;
    discountType: string;
    discount: string;
    taxType: string;
    taxRate: string;
    purchaseUnit: string;
  }[];
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

// `checkout` is untrusted (it comes from the browser): only the listed
// fields are copied, and anything malformed is left for saleSchema to reject.
export function posCheckoutToSaleInput(checkout: unknown, today: string) {
  const c = record(checkout);
  return {
    date: today,
    status: "RECEIVED",
    notes: "",
    warehouseId: c.warehouseId,
    customerId: c.customerId,
    orderTax: c.orderTax,
    discount: c.discount,
    shipping: c.shipping,
    paidAmount: c.paidAmount,
    paymentType: c.paymentType,
    items: Array.isArray(c.lines)
      ? c.lines.map((value) => {
          const line = record(value);
          return {
            productId: line.productId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            discountType: line.discountType,
            discount: line.discount,
            taxType: line.taxType,
            taxRate: line.taxRate,
            purchaseUnit: line.purchaseUnit,
          };
        })
      : c.lines,
  };
}
