import type { Role } from "@prisma/client";

export const PERMISSIONS = {
  MANAGE_WAREHOUSES: "manage_warehouses",
  MANAGE_SUPPLIERS: "manage_suppliers",
  MANAGE_CUSTOMERS: "manage_customers",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Static role -> permission map. No DB table for this yet — extend by adding
// new keys to PERMISSIONS and listing them for whichever roles should have
// them. If this ever needs to be configurable at runtime (a real admin
// Roles/Permissions page), swap ROLE_PERMISSIONS/hasPermission's internals
// for a DB-backed lookup; call sites (hasPermission(role, permission)) don't
// need to change.
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [PERMISSIONS.MANAGE_WAREHOUSES, PERMISSIONS.MANAGE_SUPPLIERS, PERMISSIONS.MANAGE_CUSTOMERS],
  MANAGER: [PERMISSIONS.MANAGE_WAREHOUSES, PERMISSIONS.MANAGE_SUPPLIERS, PERMISSIONS.MANAGE_CUSTOMERS],
  CASHIER: [],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
