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

export type NavChild = { label: string; href: string };

export type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  children?: NavChild[];
};

export const NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid, href: "/dashboard" },
  {
    key: "products",
    label: "Products",
    icon: Package,
    children: [
      { label: "Products", href: "/products" },
      { label: "Product Categories", href: "/products/categories" },
      { label: "Brands", href: "/products/brands" },
      { label: "Units", href: "/products/units" },
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
  { key: "transfers", label: "Transfers", icon: ArrowLeftRight, href: "/transfers" },
  {
    key: "expenses",
    label: "Expenses",
    icon: Receipt,
    children: [
      { label: "Expenses", href: "/expenses" },
      { label: "Expense Categories", href: "/expenses/categories" },
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
  { key: "roles", label: "Roles/Permissions", icon: ShieldCheck, href: "/roles" },
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

export function isPathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
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
      const child = item.children.find((c) => isPathActive(pathname, c.href));
      if (child) return { section: item.label, title: child.label };
    } else if (item.href && isPathActive(pathname, item.href)) {
      return { section: "RingzPOS", title: item.label };
    }
  }
  const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "dashboard";
  const title = lastSegment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { section: "RingzPOS", title };
}
