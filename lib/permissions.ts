import { MODULES } from "@/lib/modules/registry";

// THE single source of truth for permission strings. The core set is exactly
// the 27 from the PERMS array in RingzPOS Roles.dc.html, in that order; each
// optional module's (lib/modules/registry.ts) are merged in after them.
// Everything (the Role form's checkbox grid, the zod schema, the permission
// helper, the sidebar and every module check) imports from here; the strings
// are never retyped.
//
// Keys mirror the strings (MANAGE_PURCHASE ↔ "Manage Purchase"). Iterate
// with Object.values(PERMISSIONS) (keeps this order); validate with
// z.enum(PERMISSIONS).
const CORE_PERMISSIONS = {
  MANAGE_ADJUSTMENTS: "Manage Adjustments",
  MANAGE_TRANSFERS: "Manage Transfers",
  MANAGE_ROLES: "Manage Roles",
  MANAGE_BRANDS: "Manage Brands",
  MANAGE_CURRENCY: "Manage Currency",
  MANAGE_WAREHOUSES: "Manage Warehouses",
  MANAGE_UNITS: "Manage Units",
  MANAGE_PRODUCT_CATEGORIES: "Manage Product Categories",
  MANAGE_PRODUCTS: "Manage Products",
  MANAGE_SUPPLIERS: "Manage Suppliers",
  MANAGE_CUSTOMERS: "Manage Customers",
  MANAGE_USERS: "Manage Users",
  MANAGE_EXPENSE_CATEGORIES: "Manage Expense Categories",
  MANAGE_EXPENSES: "Manage Expenses",
  MANAGE_SETTING: "Manage Setting",
  MANAGE_DASHBOARD: "Manage Dashboard",
  MANAGE_POS_SCREEN: "Manage Pos Screen",
  MANAGE_PURCHASE: "Manage Purchase",
  MANAGE_SALE: "Manage Sale",
  MANAGE_PURCHASE_RETURN: "Manage Purchase Return",
  MANAGE_SALE_RETURN: "Manage Sale Return",
  MANAGE_EMAIL_TEMPLATES: "Manage Email Templates",
  MANAGE_REPORTS: "Manage Reports",
  MANAGE_QUOTATIONS: "Manage Quotations",
  MANAGE_SMS_TEMPLATES: "Manage Sms Templates",
  MANAGE_SMS_APIS: "Manage Sms Apis",
  MANAGE_LANGUAGE: "Manage Language",
} as const;

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;
type ModulePermissions = UnionToIntersection<(typeof MODULES)[number]["permissions"]>;

// Defined whether or not a module is switched on (so a role keeps what it
// was granted); while off nothing checks or shows a module's permissions.
export const PERMISSIONS = MODULES.reduce<Record<string, string>>(
  (all, mod) => ({ ...all, ...mod.permissions }),
  { ...CORE_PERMISSIONS },
) as typeof CORE_PERMISSIONS & ModulePermissions;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Every permission: the core 27 in design order, then each module's (the
// admin role's set).
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

// A block of the Role form's checkbox grid. label null: the core set.
export type PermissionGroup = { label: string | null; permissions: Permission[] };

// The Role form's groups: the core set, then one per module that's switched
// on — a module that's off adds nothing to the form.
export function permissionGroups(enabledModules: readonly string[]): PermissionGroup[] {
  return [
    { label: null, permissions: Object.values(CORE_PERMISSIONS) },
    ...MODULES.filter((mod) => enabledModules.includes(mod.id)).map((mod) => ({
      label: mod.label,
      permissions: Object.values(mod.permissions) as Permission[],
    })),
  ];
}
