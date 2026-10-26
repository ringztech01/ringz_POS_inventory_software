export type ExpenseFieldName = "date" | "title" | "warehouseId" | "expenseCategoryId" | "amount" | "details";

export type ExpenseActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<ExpenseFieldName, string[]>>;
  reference?: string;
};

// The form's values — all strings (amount is a Decimal string, never a float;
// date is YYYY-MM-DD). Also what the form sends to the save action.
export type ExpenseFormValues = {
  date: string;
  title: string;
  warehouseId: string;
  expenseCategoryId: string;
  amount: string;
  details: string;
};
