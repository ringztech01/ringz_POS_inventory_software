import type { DiscountType, PurchaseStatus, TaxType } from "@prisma/client";

export type FormOption = { id: string; name: string };

export type PurchaseFieldName =
  | "date"
  | "warehouseId"
  | "supplierId"
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
  date: string;
  warehouseId: string;
  supplierId: string;
  status: PurchaseStatus;
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
  warehouseId: string;
  supplierId: string;
  status: PurchaseStatus;
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
  taxType: TaxType;
  orderTax: string;
  // Current quantity in the selected warehouse — reference only.
  stock: number;
};
