export type CategoryActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name", string[]>>;
};
