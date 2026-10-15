export type ProductFieldName =
  | "name"
  | "code"
  | "categoryId"
  | "brandId"
  | "unitId"
  | "price"
  | "cost"
  | "stockAlert"
  | "orderTax"
  | "taxType"
  | "quantityLimitation"
  | "notes"
  | "warehouseId"
  | "supplierId"
  | "quantity"
  | "status";

export type ProductActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<ProductFieldName, string[]>>;
};

export type FormOption = { id: string; name: string };

export type ProductEditData = {
  id: string;
  name: string;
  code: string;
  categoryId: string;
  brandId: string;
  unitId: string;
  price: number;
  // Decimal string, e.g. "1250.00".
  cost: string | null;
  stockAlert: number | null;
  orderTax: number | null;
  taxType: string;
  quantityLimitation: number | null;
  notes: string | null;
  images: string[];
};

export type StockBreakdownRow = {
  warehouseId: string;
  warehouseName: string;
  quantity: number;
};
