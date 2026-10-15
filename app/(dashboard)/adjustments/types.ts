export type AdjustmentProductSearchResult = {
  id: string;
  name: string;
  code: string;
  stock: number;
};

export type AdjustmentFieldName = "warehouseId" | "date" | "items";

export type FormOption = { id: string; name: string };

export type AdjustmentActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<AdjustmentFieldName, string[]>>;
};
