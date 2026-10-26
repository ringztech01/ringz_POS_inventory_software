import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";

// The permission helper — the ONLY place access is decided. Every server
// action and every protected server page asks this, never the session's
// stale `role` claim or anything the client sends.

export type CurrentUserPermissions = {
  userId: string | null;
  roleId: string | null;
  // The seeded isSystem admin role.
  isAdmin: boolean;
  permissions: ReadonlySet<Permission>;
};

const NONE: CurrentUserPermissions = { userId: null, roleId: null, isAdmin: false, permissions: new Set() };
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

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      userRole: {
        select: { id: true, isSystem: true, deletedAt: true, permissions: { select: { permission: true } } },
      },
    },
  });
  const role = user?.userRole;
  if (!user || !role || role.deletedAt) return { ...NONE, userId: user?.id ?? null };

  if (role.isSystem) {
    return { userId: user.id, roleId: role.id, isAdmin: true, permissions: new Set(ALL_PERMISSIONS) };
  }

  return {
    userId: user.id,
    roleId: role.id,
    isAdmin: false,
    permissions: new Set(role.permissions.map((row) => row.permission).filter((p): p is Permission => KNOWN.has(p))),
  };
});

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
  if (!current.permissions.has(permission)) {
    return { error: `Forbidden — you don't have the "${permission}" permission.` };
  }
  return { userId: current.userId };
}
