// The tablet screens (Part 6g): which devices get them, and where each
// desktop service screen is on a tablet and the other way round. Pure — the
// proxy and the pages pass in what they know (the browser's user agent, the
// device's Screen setting, the touch screen it last reported).
//
// Route by device type, not by width: a device is a Tablet when an admin
// set it to Tablet (Settings › Devices) or, on Auto, when its browser is an
// Android tablet or an iPad. Desktop terminals keep the desktop POS screens.

export type DeviceScreenSetting = "AUTO" | "TABLET" | "DESKTOP";
export type DeviceKind = "TABLET" | "DESKTOP";

// Auto is on: the tablet screens are all built and checked (Part 6g Step 7),
// so a tablet on Auto gets them. (Off, only a device set to Tablet would.)
export const TABLET_AUTO_READY = true;

// Android without "Mobile" (Android tablets leave it out), an iPad, other
// tablets that say so, or an iPad's Safari in desktop mode: it says it's a
// Mac, but Macs have no touch screen.
export function isTabletBrowser(userAgent: string | null | undefined, touchScreen = false): boolean {
  const ua = userAgent ?? "";
  if (/iPad/.test(ua)) return true;
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return true;
  if (/Tablet|PlayBook|Silk|Kindle|KFAPWI|Nexus (7|9|10)/i.test(ua) && !/Mobile Safari/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && touchScreen) return true;
  return false;
}

export function deviceKind(setting: DeviceScreenSetting | null | undefined, userAgent: string | null | undefined, touchScreen = false, autoReady = TABLET_AUTO_READY): DeviceKind {
  if (setting === "TABLET") return "TABLET";
  if (setting === "DESKTOP") return "DESKTOP";
  return autoReady && isTabletBrowser(userAgent, touchScreen) ? "TABLET" : "DESKTOP";
}

// What Auto would make of this browser, for Settings › Devices ("Auto ·
// Tablet"), whether or not Auto is switched on yet.
export const detectedKind = (userAgent: string | null | undefined, touchScreen = false): DeviceKind => (isTabletBrowser(userAgent, touchScreen) ? "TABLET" : "DESKTOP");

// The tablet screens' own paths.
export const TABLET_ROOT = "/t";
export const TABLET_LOGIN = "/t/login";
export const TABLET_TABLES = "/t/tables";
export const tabletOrder = (orderId: string) => `/t/order/${encodeURIComponent(orderId)}`;
export const TABLET_NEW_ORDER = "/t/order/new";
// Served to anyone, signed in or not (the browser fetches them without the
// session): the app's manifest and icons, its service worker, the offline page.
export const TABLET_PUBLIC = ["/t/login", "/t/manifest.webmanifest", "/t/sw.js", "/t/offline", "/t/icon"];
export const isTabletPublicPath = (pathname: string) => TABLET_PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
export const isTabletPath = (pathname: string) => pathname === TABLET_ROOT || pathname.startsWith(`${TABLET_ROOT}/`);

// The paths the proxy may move between the two: the service screens, never
// the receipt, the cash-up or what prints.
export function isSwitchablePath(pathname: string): boolean {
  return pathname === "/pos" || pathname === "/pos/floor" || pathname === "/restaurant/floor" || pathname === "/restaurant/orders" || /^\/restaurant\/orders\/[^/]+$/.test(pathname) || pathname === TABLET_ROOT || pathname === TABLET_LOGIN || pathname === TABLET_TABLES || /^\/t\/order\/[^/]+$/.test(pathname);
}

const query = (params: Record<string, string | null | undefined>) => {
  const pairs = Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "");
  return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
};

type DesktopRoutes = { tables: (opts?: { areaId?: string | null }) => string; order: (orderId: string, opts?: { pay?: boolean }) => string };

// Where a request belongs on this device: the same screen in the other set,
// or null when it's already in the right place (or isn't a service screen).
// `tablet`: the device is a Tablet and its view is Service (a device kept on
// Classic keeps the Classic screens). `desktop`: the routes the device
// would use as a desktop (its Service or Classic view).
export function screenRedirect(pathname: string, search: URLSearchParams, tablet: boolean, desktop: DesktopRoutes): string | null {
  if (!isSwitchablePath(pathname)) return null;
  const area = search.get("area");
  if (tablet) {
    if (isTabletPath(pathname)) return pathname === TABLET_ROOT ? TABLET_TABLES : null;
    const order = pathname === "/pos" ? search.get("order") : pathname.startsWith("/restaurant/orders/") ? decodeURIComponent(pathname.slice("/restaurant/orders/".length)) : null;
    if (order) return `${tabletOrder(order)}${query({ pay: search.get("pay") === "1" ? "1" : null })}`;
    return `${TABLET_TABLES}${query({ area })}`;
  }
  if (!isTabletPath(pathname)) return null;
  if (pathname === TABLET_LOGIN) return "/";
  const order = /^\/t\/order\/([^/]+)$/.exec(pathname)?.[1];
  if (order && order !== "new") return desktop.order(decodeURIComponent(order), { pay: search.get("pay") === "1" });
  return desktop.tables({ areaId: area });
}
