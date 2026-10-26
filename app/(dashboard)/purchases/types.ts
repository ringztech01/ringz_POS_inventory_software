import type { DiscountType, PaymentType, PurchaseStatus, SaleReturnStatus, TaxType, TransferStatus } from "@prisma/client";

export type FormOption = { id: string; name: string };

export type PurchaseFieldName =
  | "date"
  | "warehouseId"
  | "fromWarehouseId"
  | "toWarehouseId"
  | "supplierId"
  | "customerId"
  | "paidAmount"
  | "paymentType"
  | "status"
  | "orderTax"
  | "discount"
  | "shipping"
  | "notes"
  | "items";

export type PurchaseActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<PurchaseFieldName, string[]>>;
  id?: string;
  reference?: string;
};

// One order line as the form holds it in state. Money/percent values are the
// strings the user typed (Decimal strings), only ever turned into numbers by
// lib/pricing.ts.
export type PurchaseLine = {
  productId: string;
  name: string;
  code: string;
  unitName: string;
  // Reference only: current quantity in the selected warehouse.
  stock: number;
  // Returns only, on edit: quantity this (Received) return already took out
  // of the warehouse — returnable max is stock + reserved.
  reserved?: number;
  // Sale Returns: the original sale line, and how many of it can still be
  // returned (the line's quantity cap, instead of stock).
  saleItemId?: string;
  maxQuantity?: number;
  unitCost: string;
  quantity: number;
  discountType: DiscountType;
  discount: string;
  taxType: TaxType;
  taxRate: string;
  purchaseUnit: string;
};

// The form's starting values — empty for create, the saved purchase for edit.
export type PurchaseFormInitial = {
  // "" → today (the browser's local date).
  date: string;
  // Transfers: the From warehouse.
  warehouseId: string;
  // Transfers only.
  toWarehouseId?: string;
  // Supplier (purchase documents) or customer (sales); "" for transfers.
  partyId: string;
  status: PurchaseStatus | SaleReturnStatus | TransferStatus;
  orderTax: string;
  discount: string;
  shipping: string;
  notes: string;
  lines: PurchaseLine[];
};

// What the form sends to createPurchase/updatePurchase. Only the user's
// inputs — no names, stock or totals; the server re-reads and recomputes all
// of those. Still validated as `unknown` by lib/validations/purchase.ts.
export type PurchaseSubmitPayload = {
  date: string;
  // One of these, per the document (the form's partyField) — or, for a sale
  // return, saleId instead (the server takes party + warehouse from the sale).
  warehouseId?: string;
  supplierId?: string;
  customerId?: string;
  saleId?: string;
  // Transfers: both warehouses instead of warehouseId + party.
  fromWarehouseId?: string;
  toWarehouseId?: string;
  // Sales create only: the payment taken with the sale.
  paidAmount?: string;
  paymentType?: PaymentType;
  status: PurchaseStatus | SaleReturnStatus | TransferStatus;
  orderTax: string;
  discount: string;
  shipping: string;
  notes: string;
  items: {
    productId: string;
    quantity: number;
    unitCost: string;
    discountType: DiscountType;
    discount: string;
    taxType: TaxType;
    taxRate: string;
    purchaseUnit: string;
    saleItemId?: string;
  }[];
};

// Money/percent fields are Decimal strings (never floats) so they can cross
// the server → client boundary and feed lib/pricing.ts unchanged.
export type PurchaseProductSearchResult = {
  id: string;
  name: string;
  code: string;
  unitName: string;
  // Product.cost, or "0.00" when the product has no cost set yet.
  cost: string;
  // Product.price (selling price) — the default unit price on sale lines.
  price: string;
  taxType: TaxType;
  orderTax: string;
  // Current quantity in the selected warehouse — reference only.
  stock: number;
};
