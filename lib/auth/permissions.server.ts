import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";
import { isModuleEnabled } from "@/lib/modules/enabled.server";
import { effectivePermissions, isServicePermission, NOT_ALLOWED } from "@/modules/restaurant/lib/serviceAccess";

// The permission helper — the ONLY place access is decided. Every server
// action and every protected server page asks this, never the session's
// stale `role` claim or anything the client sends.

export type CurrentUserPermissions = {
  userId: string | null;
  roleId: string | null;
  // The seeded isSystem admin role.
  isAdmin: boolean;
  permissions: ReadonlySet<Permission>;
  // Part 6f Step 5: with the Restaurant module on, a Service-level role
  // (Waiter, Cashier, Bartender, Kitchen) uses the service screens only —
  // it keeps just the service permissions (modules/restaurant/lib/
  // serviceAccess); `withheld` is what its role has beyond them.
  serviceOnly: boolean;
  withheld: ReadonlySet<Permission>;
  // The role's name ("Waiter"), for the header.
  roleName: string | null;
  // Training mode (Part 6f Step 7f): their orders are sandbox ones.
  training: boolean;
};

const NONE: CurrentUserPermissions = { userId: null, roleId: null, isAdmin: false, permissions: new Set(), serviceOnly: false, withheld: new Set(), roleName: null, training: false };
const KNOWN = new Set<string>(ALL_PERMISSIONS);

// Reads the session's user id, then the user → role → permissions from the
// DB. Memoised per request with React cache(), so a page and the actions it
// calls during one render hit the DB once.
//   - Signed out, deleted user, no role, or a soft-deleted role → nothing.
//   - The isSystem admin role → every permission, even if a RolePermission
//     row is missing.
//   - Otherwise its rows, keeping only strings still in PERMISSIONS.
export const getCurrentUserPermissions = cache(async (): Promise<CurrentUserPermissions> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NONE;
  return permissionsForUser(userId);
});

// The same for a given user id (what the session's user gets above). Also
// used by tests to see a role exactly as the page guards do.
export async function permissionsForUser(userId: string): Promise<CurrentUserPermissions> {
  const user = await prisma.user.findFirst({
    // Disabled (Part 6f: Settings › Staff): no permissions at all.
    where: { id: userId, deletedAt: null, disabledAt: null },
    select: {
      id: true,
      trainingMode: true,
      userRole: {
        select: { id: true, name: true, isSystem: true, accessLevel: true, deletedAt: true, permissions: { select: { permission: true } } },
      },
    },
  });
  const role = user?.userRole;
  if (!user || !role || role.deletedAt) return { ...NONE, userId: user?.id ?? null };

  if (role.isSystem) {
    return { userId: user.id, roleId: role.id, isAdmin: true, permissions: new Set(ALL_PERMISSIONS), serviceOnly: false, withheld: new Set(), roleName: role.name, training: user.trainingMode };
  }

  const granted = role.permissions.map((row) => row.permission).filter((p): p is Permission => KNOWN.has(p));
  const access = effectivePermissions(granted, role.accessLevel, role.accessLevel === "SERVICE" && (await isModuleEnabled("restaurant")));
  return {
    userId: user.id,
    roleId: role.id,
    isAdmin: false,
    permissions: new Set(access.permissions),
    serviceOnly: access.serviceOnly,
    withheld: new Set(access.withheld),
    roleName: role.name,
    training: user.trainingMode,
  };
}

export async function can(permission: Permission): Promise<boolean> {
  return (await getCurrentUserPermissions()).permissions.has(permission);
}

// For server actions. Returns the same shape the actions already branch on
// (`if (check.error) return { ok: false, error: check.error }`), with the
// user id for createdById etc. A missing session or permission is
// "Forbidden"; nothing is thrown.
export async function requirePermission(
  permission: Permission,
): Promise<{ error: string; userId?: undefined } | { error?: undefined; userId: string }> {
  const current = await getCurrentUserPermissions();
  if (!current.userId) {
    return { error: "You must be signed in to do that." };
  }
  // A back-office permission asked of a Service-level user (Part 6f).
  if (current.withheld.has(permission) || (current.serviceOnly && !isServicePermission(permission))) {
    return { error: NOT_ALLOWED };
  }
  if (!current.permissions.has(permission)) {
    return { error: `Forbidden — you don't have the "${permission}" permission.` };
  }
  return { userId: current.userId };
}

// The Administrator: the built-in system admin role. The ONE place that
// rule lives (the floor plan's image is Administrator-only) — Part 6f's
// access levels can change it here. `user`: the current user's permissions
// (getCurrentUserPermissions), or read for this request when left out.
export async function isSystemAdmin(user?: CurrentUserPermissions): Promise<boolean> {
  const current = user ?? (await getCurrentUserPermissions());
  return !!current.userId && current.isAdmin;
}
