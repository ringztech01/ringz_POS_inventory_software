import {
  LayoutGrid,
  Package,
  SlidersHorizontal,
  FileText,
  ShoppingCart,
  ShoppingBag,
  ArrowLeftRight,
  Receipt,
  Users,
  ShieldCheck,
  Warehouse,
  BarChart3,
  Coins,
  Languages,
  LayoutTemplate,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { PERMISSIONS, type Permission } from "@/lib/permissions";

// createTitle / editTitle: breadcrumb title on the child's /create and
// /[id]/edit pages (default: label).
export type NavChild = { label: string; href: string; createTitle?: string; editTitle?: string };

export type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  children?: NavChild[];
  // Breadcrumb section for a top-level item (default "RingzPOS").
  section?: string;
  // Breadcrumb title on its /create and /[id]/edit pages, and on its own
  // pages (default: the item's label).
  createTitle?: string;
  editTitle?: string;
  crumbTitle?: string;
};

export const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid, href: "/dashboard" },
  {
    key: "products",
    label: "Products",
    icon: Package,
    children: [
      { label: "Products", href: "/products" },
      { label: "Product Categories", href: "/product-categories" },
      { label: "Brands", href: "/brands" },
      { label: "Units", href: "/units" },
      { label: "Base Units", href: "/products/base-units" },
      { label: "Print Barcode", href: "/products/print-barcode" },
    ],
  },
  { key: "adjustments", label: "Adjustments", icon: SlidersHorizontal, href: "/adjustments" },
  { key: "quotations", label: "Quotations", icon: FileText, href: "/quotations" },
  {
    key: "purchases",
    label: "Purchases",
    icon: ShoppingCart,
    children: [
      { label: "Purchases", href: "/purchases" },
      { label: "Purchase Returns", href: "/purchases/returns" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    icon: ShoppingBag,
    children: [
      { label: "Sales", href: "/sales" },
      { label: "Sales Returns", href: "/sales/returns" },
    ],
  },
  { key: "transfers", label: "Transfers", icon: ArrowLeftRight, href: "/transfers", section: "Inventory", createTitle: "Create Transfer" },
  {
    key: "expenses",
    label: "Expenses",
    icon: Receipt,
    children: [
      { label: "Expenses", href: "/expenses", createTitle: "Create Expense", editTitle: "Edit Expense" },
      { label: "Expense Categories", href: "/expense-categories" },
    ],
  },
  {
    key: "peoples",
    label: "Peoples",
    icon: Users,
    children: [
      { label: "Suppliers", href: "/peoples/suppliers" },
      { label: "Customers", href: "/peoples/customers" },
      { label: "Users", href: "/peoples/users" },
    ],
  },
  {
    key: "roles",
    label: "Roles/Permissions",
    icon: ShieldCheck,
    href: "/roles",
    section: "Access",
    crumbTitle: "Roles",
    createTitle: "Create Role",
    editTitle: "Edit Role",
  },
  { key: "warehouse", label: "Warehouse", icon: Warehouse, href: "/warehouse" },
  { key: "reports", label: "Reports", icon: BarChart3, href: "/reports" },
  { key: "currencies", label: "Currencies", icon: Coins, href: "/currencies" },
  { key: "languages", label: "Languages", icon: Languages, href: "/languages" },
  {
    key: "templates",
    label: "Templates",
    icon: LayoutTemplate,
    children: [
      { label: "Sale Template", href: "/templates/sale" },
      { label: "Purchase Template", href: "/templates/purchase" },
    ],
  },
  { key: "settings", label: "Settings", icon: Settings, href: "/settings" },
];

// Nav item (by href) → the permission that shows it. UX only — every page and
// action enforces its own permission server-side (lib/auth). Hrefs not listed
// here (e.g. Templates, which no permission covers yet) are always shown.
export const NAV_PERMISSIONS: Partial<Record<string, Permission>> = {
  "/dashboard": PERMISSIONS.MANAGE_DASHBOARD,
  "/products": PERMISSIONS.MANAGE_PRODUCTS,
  "/product-categories": PERMISSIONS.MANAGE_PRODUCT_CATEGORIES,
  "/brands": PERMISSIONS.MANAGE_BRANDS,
  "/units": PERMISSIONS.MANAGE_UNITS,
  "/products/base-units": PERMISSIONS.MANAGE_UNITS,
  "/products/print-barcode": PERMISSIONS.MANAGE_PRODUCTS,
  "/adjustments": PERMISSIONS.MANAGE_ADJUSTMENTS,
  "/quotations": PERMISSIONS.MANAGE_QUOTATIONS,
  "/purchases": PERMISSIONS.MANAGE_PURCHASE,
  "/purchases/returns": PERMISSIONS.MANAGE_PURCHASE_RETURN,
  "/sales": PERMISSIONS.MANAGE_SALE,
  "/sales/returns": PERMISSIONS.MANAGE_SALE_RETURN,
  "/transfers": PERMISSIONS.MANAGE_TRANSFERS,
  "/expenses": PERMISSIONS.MANAGE_EXPENSES,
  "/expense-categories": PERMISSIONS.MANAGE_EXPENSE_CATEGORIES,
  "/peoples/suppliers": PERMISSIONS.MANAGE_SUPPLIERS,
  "/peoples/customers": PERMISSIONS.MANAGE_CUSTOMERS,
  "/peoples/users": PERMISSIONS.MANAGE_USERS,
  "/roles": PERMISSIONS.MANAGE_ROLES,
  "/warehouse": PERMISSIONS.MANAGE_WAREHOUSES,
  "/reports": PERMISSIONS.MANAGE_REPORTS,
  "/currencies": PERMISSIONS.MANAGE_CURRENCY,
  "/languages": PERMISSIONS.MANAGE_LANGUAGE,
  "/settings": PERMISSIONS.MANAGE_SETTING,
};

const allowed = (href: string, permissions: ReadonlySet<Permission>) => {
  const needed = NAV_PERMISSIONS[href];
  return !needed || permissions.has(needed);
};

// The nav the user may see: items and children they have the permission for;
// a group shows if any of its children does.
export function visibleNav(permissions: ReadonlySet<Permission>): NavItem[] {
  return NAV.flatMap((item) => {
    if (item.children?.length) {
      const children = item.children.filter((child) => allowed(child.href, permissions));
      return children.length > 0 ? [{ ...item, children }] : [];
    }
    return !item.href || allowed(item.href, permissions) ? [item] : [];
  });
}

export function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// The most specific child matching the path (longest href). Needed because
// sibling routes can nest: /purchases/returns also starts with /purchases,
// and only "Purchase Returns" should be active there.
export function findActiveChild(pathname: string, children: NavChild[]): NavChild | undefined {
  return children
    .filter((child) => isPathActive(pathname, child.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function findOpenGroupForPath(pathname: string): string | null {
  for (const item of NAV) {
    if (item.children?.some((child) => isPathActive(pathname, child.href))) {
      return item.key;
    }
  }
  return null;
}

export function resolveBreadcrumb(pathname: string): { section: string; title: string } {
  for (const item of NAV) {
    if (item.children?.length) {
      const child = findActiveChild(pathname, item.children);
      if (child) {
        const rest = pathname.slice(child.href.length);
        const title =
          child.createTitle && rest === "/create"
            ? child.createTitle
            : child.editTitle && /^\/[^/]+\/edit$/.test(rest)
              ? child.editTitle
              : child.label;
        return { section: item.label, title };
      }
    } else if (item.href && isPathActive(pathname, item.href)) {
      const rest = pathname.slice(item.href.length);
      const title =
        item.createTitle && rest === "/create"
          ? item.createTitle
          : item.editTitle && /^\/[^/]+\/edit$/.test(rest)
            ? item.editTitle
            : (item.crumbTitle ?? item.label);
      return { section: item.section ?? "RingzPOS", title };
    }
  }
  const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "dashboard";
  const title = lastSegment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { section: "RingzPOS", title };
}
