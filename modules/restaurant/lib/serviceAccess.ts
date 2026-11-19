import { PERMISSIONS, type Permission } from "@/lib/permissions";

// Service-level access (Part 6f Step 5). With the Restaurant module on,
// someone whose role is Service-level (Waiter, Cashier, Bartender, Kitchen —
// Settings › Restaurant › Roles) uses the service screens only: the touch
// POS and Tables, the kitchen display, the Classic floor and order screens,
// and what they print. Everything else is the back office — blocked on the
// server (the proxy sends them to their home screen; actions answer "Not
// allowed"), not just hidden. Back-office roles (Manager, Administrator)
// use both. Module off: nothing here applies (retail is unchanged).

// The permissions the service screens use. A Service-level role keeps only
// these, whatever else it's been given.
export const SERVICE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.MANAGE_ORDERS,
  PERMISSIONS.KITCHEN_DISPLAY,
  PERMISSIONS.MANAGE_KITCHEN,
  PERMISSIONS.SETTLE_BILL,
  PERMISSIONS.MANAGE_RESERVATIONS,
  PERMISSIONS.APPROVE_DISCOUNT,
  PERMISSIONS.APPROVE_VOID,
  PERMISSIONS.LOG_WASTE,
  PERMISSIONS.APPROVE_WASTE,
  PERMISSIONS.OPEN_DRAWER,
  // The Classic view's counter POS (/pos), for a Cashier.
  PERMISSIONS.MANAGE_POS_SCREEN,
];

const SERVICE_SET = new Set<string>(SERVICE_PERMISSIONS);
export const isServicePermission = (permission: string) => SERVICE_SET.has(permission);

// What a role may use: everything it was given — or, Service-level with the
// module on, only the service permissions (`withheld`: the rest it has).
export function effectivePermissions<P extends string>(granted: readonly P[], accessLevel: "SERVICE" | "BACK_OFFICE", restaurantOn: boolean): { serviceOnly: boolean; permissions: P[]; withheld: P[] } {
  const serviceOnly = accessLevel === "SERVICE" && restaurantOn;
  if (!serviceOnly) return { serviceOnly, permissions: [...granted], withheld: [] };
  return { serviceOnly, permissions: granted.filter(isServicePermission), withheld: granted.filter((p) => !isServicePermission(p)) };
}

// The pages and files a Service-level user may open: exact paths, and
// prefixes (a prefix ending in "/" covers what's under it; one without also
// covers the path itself).
const EXACT = new Set(["/", "/restaurant/tables", "/restaurant/settings/approval-pin", "/favicon.ico"]);
const PREFIXES = [
  // Sign-in and the session.
  "/api/auth/",
  // The touch POS, Tables and the POS receipt.
  "/pos",
  // The tablet screens (Part 6g).
  "/t",
  // The kitchen display.
  "/restaurant/kitchen",
  // Classic: the floor, the open orders and an order.
  "/restaurant/floor",
  "/restaurant/orders",
  // What the service screens print.
  "/restaurant/bill/",
  "/restaurant/kot/",
  "/restaurant/receipt/",
  // The floor plan's background pictures; uploaded files.
  "/restaurant/settings/floor/image/",
  "/uploads/",
  // The customer-facing display.
  "/customer-display",
  // Next's own files (the dev server's too).
  "/_next/",
  "/__nextjs",
];

export function isServicePath(pathname: string): boolean {
  if (EXACT.has(pathname)) return true;
  return PREFIXES.some((prefix) => (prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`)));
}

export const NOT_ALLOWED = "Not allowed";
