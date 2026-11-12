import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { DEVICE_COOKIE, DEVICE_ID } from "@/lib/hardware/device";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { isServicePath } from "@/modules/restaurant/lib/serviceAccess";
import { staffHomeOn } from "@/modules/restaurant/server/services/pinSignIn";

const PUBLIC_PATHS = ["/", "/api/auth"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  if (!req.auth && !isPublicPath(pathname)) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // Part 6f Step 5: with the Restaurant module on, a Service-level user
  // (Waiter, Cashier, Bartender, Kitchen) asking for a back-office page —
  // the dashboard, settings, products, reports, food… — goes to their home
  // screen instead. Blocked here on the server, not hidden; the actions
  // refuse too ("Not allowed", lib/auth/permissions.server).
  const user = req.auth?.user;
  if (user?.id && user.accessLevel === "SERVICE" && !isServicePath(pathname)) {
    const home = await serviceHome(user.id, req.cookies.get(DEVICE_COOKIE)?.value ?? "");
    if (home) return NextResponse.redirect(new URL(home, req.nextUrl));
  }
});

// Their home screen, or null to let the request through: the module off
// (retail is unchanged), or the look-up failed (the page's own permission
// check still stands).
async function serviceHome(userId: string, deviceCookie: string): Promise<string | null> {
  try {
    if (!(await isModuleEnabled("restaurant"))) return null;
    const home = await staffHomeOn(userId, DEVICE_ID.test(deviceCookie) ? deviceCookie : null);
    return isServicePath(new URL(home, "http://x").pathname) ? home : "/";
  } catch (error) {
    console.warn("[proxy] couldn't find a home screen:", error);
    return null;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
