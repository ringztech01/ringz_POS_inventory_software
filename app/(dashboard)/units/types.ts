export type UnitActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name", string[]>>;
};
