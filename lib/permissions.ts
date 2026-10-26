// THE single source of truth for permission strings — exactly the 27 from the
// PERMS array in RingzPOS Roles.dc.html, in that order. Everything (the Role
// form's checkbox grid, the zod schema, the permission helper, the sidebar
// and every module check) imports from here; the strings are never retyped.
//
// Keys mirror the strings (MANAGE_PURCHASE ↔ "Manage Purchase"). Iterate
// with Object.values(PERMISSIONS) (keeps this order); validate with
// z.enum(PERMISSIONS).
export const PERMISSIONS = {
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

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// All 27, in design order (the Role form's grid, the admin role's set).
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];
