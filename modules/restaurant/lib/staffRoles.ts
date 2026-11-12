import type { ServiceRoutes } from "./serviceRoutes";

// Staff roles (Part 6f Step 2): the six built-in roles, what each can reach
// (its access level) and where it lands after the PIN (its home screen).

export type SystemRole = "ADMINISTRATOR" | "MANAGER" | "CASHIER" | "WAITER" | "BARTENDER" | "KITCHEN";
export type AccessLevel = "SERVICE" | "BACK_OFFICE";
export type HomeScreen = "TABLES" | "BAR" | "CASHIER" | "KITCHEN";

export const SYSTEM_ROLES: readonly SystemRole[] = ["ADMINISTRATOR", "MANAGER", "CASHIER", "WAITER", "BARTENDER", "KITCHEN"];
export const SYSTEM_ROLE_INFO: Record<SystemRole, { name: string; access: AccessLevel; home: HomeScreen; about: string }> = {
  ADMINISTRATOR: { name: "Administrator", access: "BACK_OFFICE", home: "TABLES", about: "Everything, including staff, PINs and these settings." },
  MANAGER: { name: "Manager", access: "BACK_OFFICE", home: "TABLES", about: "Runs the floor and the back office." },
  CASHIER: { name: "Cashier", access: "SERVICE", home: "CASHIER", about: "Takes payment and closes bills." },
  WAITER: { name: "Waiter", access: "SERVICE", home: "TABLES", about: "Seats guests and takes orders." },
  BARTENDER: { name: "Bartender", access: "SERVICE", home: "BAR", about: "The bar and its tabs." },
  KITCHEN: { name: "Kitchen", access: "SERVICE", home: "KITCHEN", about: "The kitchen display for their station." },
};

export const ACCESS_LEVELS: readonly AccessLevel[] = ["SERVICE", "BACK_OFFICE"];
export const ACCESS_INFO: Record<AccessLevel, { label: string; about: string }> = {
  SERVICE: { label: "Service", about: "The service screens only: PIN login, Tables, the POS, the kitchen display." },
  BACK_OFFICE: { label: "Back office", about: "The service screens and the back office: dashboard, settings, inventory, reports." },
};

export const HOME_SCREENS: readonly HomeScreen[] = ["TABLES", "BAR", "CASHIER", "KITCHEN"];
export const HOME_INFO: Record<HomeScreen, { label: string; about: string; area: boolean; station: boolean }> = {
  TABLES: { label: "Tables", about: "The Tables screen.", area: true, station: false },
  BAR: { label: "Tables · bar", about: "Tables on the bar's area, with the bar tabs first.", area: true, station: false },
  CASHIER: { label: "Tables · pay", about: "Tables with Pay and Split first.", area: true, station: false },
  KITCHEN: { label: "Kitchen display", about: "The kitchen display for one station (or all).", area: false, station: true },
};

export type RoleHome = { homeScreen: HomeScreen; homeAreaId: string | null; homeStation: string | null };

// Where someone with this role lands, in this device's view (Service or
// Classic). Back-office roles land on Tables too; the service header gives
// them a Back office button (Step 5).
export function homeHref(role: RoleHome, routes: ServiceRoutes): string {
  if (role.homeScreen === "KITCHEN") return `/restaurant/kitchen${role.homeStation ? `?station=${encodeURIComponent(role.homeStation)}` : ""}`;
  const focus = role.homeScreen === "BAR" ? "bar" : role.homeScreen === "CASHIER" ? "pay" : null;
  return routes.tables({ areaId: role.homeAreaId, focus });
}

// The rule for who may assign a role lives in core (lib/auth/roleRules):
// the Administrator part applies in retail too.
export { assignRoleProblem } from "@/lib/auth/roleRules";
