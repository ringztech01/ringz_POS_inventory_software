// Which restaurant screens the app uses (Part 6f Step 1), and where they
// live. Two views, the same actions and data behind both:
//   SERVICE (the default) — PIN login → the touch Tables screen → the
//     Restaurant POS (/pos/floor, /pos?order=…).
//   CLASSIC — the back-office screens: Restaurant › Floor and the Table
//     order page (/restaurant/floor, /restaurant/orders/…); /pos is the
//     retail counter POS.
// The business picks one (Settings › Restaurant › Interface); a device can
// keep its own (Settings › Devices). Every link, redirect and Tables button
// that means "the tables screen" or "this order" goes through here — nothing
// hard-codes a view.

export type RestaurantView = "SERVICE" | "CLASSIC";
export const RESTAURANT_VIEWS: readonly RestaurantView[] = ["SERVICE", "CLASSIC"];
export const DEFAULT_VIEW: RestaurantView = "SERVICE";
export const SERVICE_TABLES = "/pos/floor";

export type TablesFocus = "bar" | "pay";

export type ServiceRoutes = {
  view: RestaurantView;
  // The tables screen: an area; on the touch POS, the order it came from
  // (its Back button) and what to put first — the bar tabs (a Bartender's
  // home) or Pay and Split (a Cashier's).
  tables: (opts?: { areaId?: string | null; from?: string | null; focus?: TablesFocus | null }) => string;
  // An order's screen (on the touch POS, opened on its payment).
  order: (orderId: string, opts?: { pay?: boolean }) => string;
  // The POS: the Restaurant POS (Service) or the retail counter POS (Classic).
  pos: string;
};

type Picks = { restaurantInterface?: RestaurantView | null } | null | undefined;

// The device's own view if it has one, else the business's, else Service.
export function resolveView(business: Picks, device: Picks): RestaurantView {
  return device?.restaurantInterface ?? business?.restaurantInterface ?? DEFAULT_VIEW;
}

const query = (params: Record<string, string | null | undefined | false>) => {
  const pairs = Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");
  return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
};

export function routesFor(view: RestaurantView): ServiceRoutes {
  if (view === "CLASSIC")
    return {
      view,
      tables: (opts) => `/restaurant/floor${query({ area: opts?.areaId })}`,
      order: (orderId) => `/restaurant/orders/${encodeURIComponent(orderId)}`,
      pos: "/pos",
    };
  return {
    view,
    tables: (opts) => `${SERVICE_TABLES}${query({ area: opts?.areaId, from: opts?.from, focus: opts?.focus })}`,
    order: (orderId, opts) => `/pos${query({ order: orderId, pay: opts?.pay ? "1" : null })}`,
    pos: "/pos",
  };
}

// The spec's resolver: the business's setting and this device's → the
// Tables, Order and POS routes.
export const resolveServiceRoutes = (business: Picks, device: Picks): ServiceRoutes => routesFor(resolveView(business, device));
