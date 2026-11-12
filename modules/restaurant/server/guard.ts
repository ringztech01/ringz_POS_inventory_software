import "server-only";
import { createElement, type ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { pageGuard } from "@/lib/auth/page-guard";
import ForbiddenState from "@/components/ui/ForbiddenState";
import { getCurrentUserPermissions, isSystemAdmin, requirePermission as requireAppPermission } from "@/lib/auth/permissions.server";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import type { Permission } from "@/lib/permissions";
import { RESTAURANT_PERMISSIONS, restaurantModule, type RestaurantPermission } from "../manifest";

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

// For server actions behind a core permission that only exist with the
// module on (Part 6f: the restaurant's Interface and a device's view need
// Manage Setting): refused while the module is off, then the app's check.
export async function requireCorePermission(permission: Permission): ReturnType<typeof requireAppPermission> {
  if (!(await isModuleEnabled(restaurantModule.id))) {
    return { error: "The Restaurant module is turned off." };
  }
  return requireAppPermission(permission);
}

// Administrator only (Part 6f: staff roles, PINs): the module on, signed in,
// the built-in Administrator role (isSystemAdmin — the one place that rule
// lives). Not a permission a Manager can be given.
export async function requireAdministrator(): Promise<{ error: string; userId?: undefined } | { error?: undefined; userId: string }> {
  if (!(await isModuleEnabled(restaurantModule.id))) return { error: "The Restaurant module is turned off." };
  const current = await getCurrentUserPermissions();
  if (!current.userId) return { error: "You must be signed in to do that." };
  if (!(await isSystemAdmin(current))) return { error: "Only an Administrator can do that." };
  return { userId: current.userId };
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

// The floor plan editor: on the server, never just a hidden link — a page
// redirects anyone without Manage Floor Plan (waiters, cashiers, bartenders,
// the kitchen) to the app's start, and every action refuses them
// (requireFloorPlan). Managers and the Administrator only.
// TODO(6f): also require accessLevel BACK_OFFICE.
export async function guardFloorPlanPage(): Promise<{ userId: string }> {
  await requireRestaurant();
  const current = await getCurrentUserPermissions();
  if (!current.userId) redirect("/");
  if (!current.permissions.has(RESTAURANT_PERMISSIONS.MANAGE_FLOOR_PLAN)) redirect("/");
  return { userId: current.userId };
}

// For the floor plan's server actions: the module on, signed in, Manage
// Floor Plan. TODO(6f): also require accessLevel BACK_OFFICE.
export const requireFloorPlan = () => requirePermission(RESTAURANT_PERMISSIONS.MANAGE_FLOOR_PLAN);
