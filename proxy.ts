import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { DEVICE_COOKIE, DEVICE_ID } from "@/lib/hardware/device";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { isServicePath } from "@/modules/restaurant/lib/serviceAccess";
import { GUEST_SURFACE_HEADER, isGuestMenuPath } from "@/modules/restaurant/lib/publicMenu";
import { staffHomeOn } from "@/modules/restaurant/server/services/pinSignIn";
import { isSwitchablePath, isTabletPath, isTabletPublicPath, screenRedirect } from "@/modules/restaurant/lib/tabletDevice";
import { resolveView, routesFor } from "@/modules/restaurant/lib/serviceRoutes";
import { deviceIsTablet } from "@/modules/restaurant/server/tabletDevice";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";

const PUBLIC_PATHS = ["/", "/api/auth"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) || isTabletPublicPath(pathname);
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  // Part 8: the guest's digital menu (/menu/…) is public — guests scan a QR
  // code on the restaurant's Wi-Fi, no sign-in — and staff signed in on the
  // same phone see it too. Marked so the root layout serves it lean.
  if (isGuestMenuPath(pathname)) {
    const headers = new Headers(req.headers);
    headers.set(GUEST_SURFACE_HEADER, "menu");
    return NextResponse.next({ request: { headers } });
  }
  if (!req.auth && !isPublicPath(pathname)) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // Part 6g: the tablet screens on a Tablet, the desktop ones elsewhere —
  // by device type, not by width. Only the service screens move (never what
  // prints, the receipt or the cash-up); module off, nothing here applies.
  if (req.auth?.user?.id && isSwitchablePath(pathname)) {
    const target = await screenTarget(pathname, req.nextUrl.searchParams, req.cookies.get(DEVICE_COOKIE)?.value ?? "", req.headers.get("user-agent"));
    if (target) return NextResponse.redirect(new URL(target, req.nextUrl));
  }

  // Part 6f Step 5: with the Restaurant module on, a Service-level user
  // (Waiter, Cashier, Bartender, Kitchen) asking for a back-office page —
  // the dashboard, settings, products, reports, food… — goes to their home
  // screen instead. Blocked here on the server, not hidden; the actions
  // refuse too ("Not allowed", lib/auth/permissions.server).
  const user = req.auth?.user;
  if (user?.id && user.accessLevel === "SERVICE" && !isServicePath(pathname)) {
    const home = await serviceHome(user.id, req.cookies.get(DEVICE_COOKIE)?.value ?? "", req.headers.get("user-agent"));
    if (home) return NextResponse.redirect(new URL(home, req.nextUrl));
  }

  // The tablet screens are served lean too: system fonts, no web fonts (a
  // tablet on the restaurant's Wi-Fi may have no internet).
  if (isTabletPath(pathname)) {
    const headers = new Headers(req.headers);
    headers.set(GUEST_SURFACE_HEADER, "tablet");
    return NextResponse.next({ request: { headers } });
  }

  // Only the proxy marks a guest menu request: one sent from outside is dropped.
  if (req.headers.has(GUEST_SURFACE_HEADER)) {
    const headers = new Headers(req.headers);
    headers.delete(GUEST_SURFACE_HEADER);
    return NextResponse.next({ request: { headers } });
  }
});

// The same screen in the set this device uses, or null to let it through
// (already right, the module off, or the look-up failed).
async function screenTarget(pathname: string, search: URLSearchParams, deviceCookie: string, userAgent: string | null): Promise<string | null> {
  try {
    if (!(await isModuleEnabled("restaurant"))) return null;
    const deviceId = DEVICE_ID.test(deviceCookie) ? deviceCookie : null;
    const [business, device, tablet] = await Promise.all([
      prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantInterface: true } }),
      deviceId ? prisma.device.findUnique({ where: { id: deviceId }, select: { restaurantInterface: true } }) : null,
      deviceIsTablet(deviceId, userAgent),
    ]);
    const view = resolveView(business, device);
    return screenRedirect(pathname, search, tablet && view === "SERVICE", routesFor(view));
  } catch (error) {
    console.warn("[proxy] couldn't place the screen:", error);
    return null;
  }
}

// Their home screen, or null to let the request through: the module off
// (retail is unchanged), or the look-up failed (the page's own permission
// check still stands).
async function serviceHome(userId: string, deviceCookie: string, userAgent: string | null): Promise<string | null> {
  try {
    if (!(await isModuleEnabled("restaurant"))) return null;
    const home = await staffHomeOn(userId, DEVICE_ID.test(deviceCookie) ? deviceCookie : null, userAgent);
    return isServicePath(new URL(home, "http://x").pathname) ? home : "/";
  } catch (error) {
    console.warn("[proxy] couldn't find a home screen:", error);
    return null;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
