import { UtensilsCrossed } from "lucide-react";
import { defineModule } from "@/lib/modules/types";

// The Restaurant module's manifest: what it adds to the app shell. Listed in
// lib/modules/registry.ts; nothing here runs while the module is off.

export const RESTAURANT_PERMISSIONS = {
  RESTAURANT_DASHBOARD: "Restaurant Dashboard",
  MANAGE_FOOD: "Manage Food",
  MANAGE_TABLES: "Manage Tables",
  MANAGE_ORDERS: "Manage Orders",
  // Kitchen Display: view the board and print tickets. Manage Kitchen: change
  // line statuses, bump and recall.
  KITCHEN_DISPLAY: "Kitchen Display",
  MANAGE_RESERVATIONS: "Manage Reservations",
  RESTAURANT_REPORTS: "Restaurant Reports",
  RESTAURANT_SETTINGS: "Restaurant Settings",
  MANAGE_KITCHEN: "Manage Kitchen",
  // Take payment and close the bill (Part 6).
  SETTLE_BILL: "Settle Bill",
  // Approve a discount above the limit with a PIN, and set that PIN.
  APPROVE_DISCOUNT: "Approve Discount",
  // Log waste (Food › Waste, the kitchen display, a returned order line).
  LOG_WASTE: "Log Waste",
  // Approve waste above the limit with a PIN (and set that PIN); void waste.
  APPROVE_WASTE: "Approve Waste",
  // Void a sent line and refund a settled bill without a manager's PIN — and
  // approve them with a PIN for someone who can't (Part 6e).
  APPROVE_VOID: "Approve Voids & Refunds",
  // Lay out each dining area to match the room: the floor plan editor. For
  // Managers and the Administrator (the system admin role has every
  // permission).
  MANAGE_FLOOR_PLAN: "Manage Floor Plan",
  // The audit view (Part 6f Step 7e): sign-ins, failed PINs, overrides,
  // voids, drawer opens, PIN and staff changes. Managers and the
  // Administrator.
  VIEW_AUDIT_LOG: "View Audit Log",
  // Cost and margin in Restaurant Reports (on screen and in exports).
  // Managers and the Administrator.
  VIEW_COST: "View Cost",
} as const;

export type RestaurantPermission = (typeof RESTAURANT_PERMISSIONS)[keyof typeof RESTAURANT_PERMISSIONS];

const P = RESTAURANT_PERMISSIONS;

export const restaurantModule = defineModule({
  id: "restaurant",
  label: "Restaurant",
  description: "Floor plan, table orders, kitchen display, food management, tables and the digital menu.",
  icon: UtensilsCrossed,
  permissions: RESTAURANT_PERMISSIONS,
  // The header nav from the RingzPOS restaurant designs, in order.
  nav: [
    { label: "Dashboard", href: "/restaurant", permissions: [P.RESTAURANT_DASHBOARD] },
    // Anyone working the floor can look; opening orders needs Manage Orders.
    {
      label: "Floor",
      href: "/restaurant/floor",
      permissions: [P.MANAGE_ORDERS, P.MANAGE_TABLES, P.MANAGE_RESERVATIONS, P.RESTAURANT_DASHBOARD],
    },
    { label: "Orders", href: "/restaurant/orders", permissions: [P.MANAGE_ORDERS] },
    { label: "Kitchen", href: "/restaurant/kitchen", permissions: [P.KITCHEN_DISPLAY] },
    // Menu items, modifiers and recipes need Manage Food; the Waste tab, Log
    // Waste or Approve Waste (lib/foodTabs.ts).
    { label: "Food", href: "/restaurant/food", permissions: [P.MANAGE_FOOD, P.LOG_WASTE, P.APPROVE_WASTE] },
    // Tables, areas and reservations share the page; each part needs its own.
    { label: "Tables", href: "/restaurant/tables", permissions: [P.MANAGE_TABLES, P.MANAGE_RESERVATIONS] },
    // The menu (Manage Food) and its QR codes (Manage Floor Plan; the Administrator has both).
    { label: "Digital menu", href: "/restaurant/digital-menu", permissions: [P.MANAGE_FOOD, P.MANAGE_FLOOR_PLAN] },
    // Sidebar only (the designs' header has the seven tabs above).
    // Back office (Managers and the Administrator): sales, dishes, staff,
    // tables, payments, waste, voids and cash-up.
    { label: "Reports", href: "/restaurant/reports", permissions: [P.RESTAURANT_REPORTS], header: false },
    { label: "Prep times", href: "/restaurant/reports/prep-times", permissions: [P.RESTAURANT_REPORTS], header: false },
    { label: "Stations", href: "/restaurant/settings/stations", permissions: [P.RESTAURANT_SETTINGS], header: false },
    { label: "Touch POS", href: "/restaurant/settings/pos", permissions: [P.RESTAURANT_SETTINGS], header: false },
    { label: "Floor plan", href: "/restaurant/settings/floor", permissions: [P.MANAGE_FLOOR_PLAN], header: false },
    // One PIN per person: the touch POS sign-in, and approvals for those who approve.
    { label: "My PIN", href: "/restaurant/settings/approval-pin", permissions: [P.MANAGE_ORDERS, P.APPROVE_DISCOUNT, P.APPROVE_WASTE], header: false },
    // This till's float, cash-up and Z-report (Part 6f Step 7b).
    { label: "Cash-up", href: "/pos/cash-up", permissions: [P.SETTLE_BILL], header: false },
    // Who did what, when (Part 6f Step 7e).
    { label: "Audit log", href: "/settings/restaurant/audit", permissions: [P.VIEW_AUDIT_LOG], header: false },
  ],
  toggle: { setting: "restaurantEnabled", permission: P.RESTAURANT_SETTINGS },
  isEnabled: (settings) => settings.restaurantEnabled,
});
