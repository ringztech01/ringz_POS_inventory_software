import "server-only";
import { createElement, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { pageGuard } from "@/lib/auth/page-guard";
import ForbiddenState from "@/components/ui/ForbiddenState";
import { getCurrentUserPermissions, requirePermission as requireAppPermission } from "@/lib/auth/permissions.server";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { restaurantModule, type RestaurantPermission } from "../manifest";

// Every restaurant layout, page and action goes through here. While the
// module is switched off it doesn't exist: routes 404 and actions refuse.

export async function requireRestaurant(): Promise<void> {
  if (!(await isModuleEnabled(restaurantModule.id))) {
    notFound();
  }
}

// For server actions: the app's permission check (lib/auth) — same result
// shape — refused first while the module is off.
export async function requirePermission(permission: RestaurantPermission): ReturnType<typeof requireAppPermission> {
  if (!(await isModuleEnabled(restaurantModule.id))) {
    return { error: "The Restaurant module is turned off." };
  }
  return requireAppPermission(permission);
}

// For route handlers (no layout runs before them): a 404 while off, 401
// signed out, 403 without the permission — or null to carry on.
export async function guardRoute(permission: RestaurantPermission): Promise<Response | null> {
  if (!(await isModuleEnabled(restaurantModule.id))) return new Response("Not found", { status: 404 });
  const current = await getCurrentUserPermissions();
  if (!current.userId) return new Response("Unauthorized", { status: 401 });
  if (!current.permissions.has(permission)) return new Response("Forbidden", { status: 403 });
  return null;
}

// For pages: 404 while off, then null or the 403 state (lib/auth pageGuard).
// Pages call this even though the layout checks too — Next renders a layout
// and its page in parallel, so the page mustn't rely on the layout's check.
export async function guardPage(permission: RestaurantPermission): Promise<ReactNode | null> {
  await requireRestaurant();
  return pageGuard(permission);
}

// For a page made of parts with different permissions (Tables: tables and
// areas, reservations): opens with any one of them; each part checks its own.
export async function guardPageAny(permissions: readonly RestaurantPermission[]): Promise<ReactNode | null> {
  await requireRestaurant();
  const current = await getCurrentUserPermissions();
  if (permissions.some((permission) => current.permissions.has(permission))) return null;
  return createElement(ForbiddenState, { permission: permissions.join(" or ") });
}
