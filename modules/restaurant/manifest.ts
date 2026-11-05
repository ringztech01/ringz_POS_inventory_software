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
    { label: "Digital menu", href: "/restaurant/digital-menu", permissions: [P.MANAGE_FOOD] },
    // Sidebar only (the designs' header has the seven tabs above).
    { label: "Prep times", href: "/restaurant/reports/prep-times", permissions: [P.RESTAURANT_REPORTS], header: false },
    { label: "Stations", href: "/restaurant/settings/stations", permissions: [P.RESTAURANT_SETTINGS], header: false },
    { label: "Approval PIN", href: "/restaurant/settings/approval-pin", permissions: [P.APPROVE_DISCOUNT, P.APPROVE_WASTE], header: false },
  ],
  toggle: { setting: "restaurantEnabled", permission: P.RESTAURANT_SETTINGS },
  isEnabled: (settings) => settings.restaurantEnabled,
});
