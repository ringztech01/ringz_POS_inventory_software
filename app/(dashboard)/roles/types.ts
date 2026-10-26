import type { Permission } from "@/lib/permissions";

export type RoleFieldName = "name" | "permissions";

export type RoleActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<RoleFieldName, string[]>>;
};

// What the form holds and sends: the name and the checked permissions.
export type RoleFormValues = {
  name: string;
  permissions: Permission[];
};
