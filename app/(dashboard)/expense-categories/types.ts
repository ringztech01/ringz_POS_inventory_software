export type ExpenseCategoryActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name", string[]>>;
};
