export type BrandActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name", string[]>>;
};
