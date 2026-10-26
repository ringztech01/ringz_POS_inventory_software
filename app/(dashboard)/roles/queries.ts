import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";
import type { RoleRow } from "@/components/roles/RoleTable";

export type RoleListParams = { q?: string; page?: number; perPage?: number };

// Active roles only. Search (?q=) matches the name; pagination runs here,
// server-side.
export async function getRoleList({ q, page = 1, perPage = 10 }: RoleListParams) {
  const where: Prisma.RoleWhereInput = {
    deletedAt: null,
    ...(q ? { name: { contains: q } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.role.count({ where }),
    prisma.role.findMany({
      where,
      select: { id: true, name: true, isSystem: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  // The date is formatted here: rows go to a client component, and
  // formatting on the server keeps the browser's timezone from changing it.
  const roles: RoleRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    isSystem: row.isSystem,
    createdDate: formatDateTime(row.createdAt).date,
  }));

  return { roles, total };
}

// Pre-fill for /roles/[id]/edit: the name and the checked set (only strings
// that are still canonical). Null for missing or soft-deleted roles.
export async function getRoleForEdit(id: string) {
  const role = await prisma.role.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, isSystem: true, permissions: { select: { permission: true } } },
  });
  if (!role) return null;

  const known = new Set<string>(ALL_PERMISSIONS);
  return {
    id: role.id,
    isSystem: role.isSystem,
    initial: {
      name: role.name,
      permissions: role.permissions.map((row) => row.permission).filter((p): p is Permission => known.has(p)),
    },
  };
}

// Select options (the user form's Role dropdown): active roles only.
export async function getActiveRoles() {
  return prisma.role.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
