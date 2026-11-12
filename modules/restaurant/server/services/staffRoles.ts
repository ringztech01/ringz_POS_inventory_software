import "server-only";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getEnabledModuleIds } from "@/lib/modules/enabled.server";
import { ALL_PERMISSIONS, permissionGroups, type PermissionGroup } from "@/lib/permissions";
import { SYSTEM_ROLES, type AccessLevel, type HomeScreen, type SystemRole } from "../../lib/staffRoles";
import type { CopyRoleInput, RoleMatrixInput } from "../../schemas/staffRoles";

// The role matrix (Part 6f Step 2; Administrator only — the actions check):
// every live role with its permissions, access level and home screen; saved
// together; Copy role makes a custom role from any one. Each change is in
// the audit log.

export type MatrixRole = {
  id: string;
  name: string;
  isAdmin: boolean;
  systemRole: SystemRole | null;
  accessLevel: AccessLevel;
  homeScreen: HomeScreen;
  homeAreaId: string | null;
  homeStation: string | null;
  permissions: string[];
  users: number;
};
export type RoleMatrix = {
  roles: MatrixRole[];
  groups: PermissionGroup[];
  areas: { id: string; name: string }[];
  stations: { code: string; name: string }[];
};

const order = (role: { systemRole: SystemRole | null; name: string }) => (role.systemRole ? SYSTEM_ROLES.indexOf(role.systemRole) : SYSTEM_ROLES.length);

export async function getRoleMatrix(): Promise<RoleMatrix> {
  const [roles, areas, stations, modules] = await Promise.all([
    prisma.role.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        isSystem: true,
        systemRole: true,
        accessLevel: true,
        homeScreen: true,
        homeAreaId: true,
        homeStation: true,
        permissions: { select: { permission: true } },
        _count: { select: { users: { where: { deletedAt: null } } } },
      },
    }),
    prisma.diningArea.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    prisma.kitchenStation.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true } }),
    getEnabledModuleIds(),
  ]);
  return {
    roles: roles
      .map((r) => ({
        id: r.id,
        name: r.name,
        isAdmin: r.isSystem,
        systemRole: r.systemRole,
        accessLevel: r.isSystem ? ("BACK_OFFICE" as const) : r.accessLevel,
        homeScreen: r.homeScreen,
        homeAreaId: r.homeAreaId,
        homeStation: r.homeStation,
        // The Administrator has every permission whatever is stored.
        permissions: r.isSystem ? [...ALL_PERMISSIONS] : r.permissions.map((p) => p.permission).sort(),
        users: r._count.users,
      }))
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)),
    // The restaurant's own permissions first (what this page is mostly
    // for), then the core ones.
    groups: [...permissionGroups(modules)].sort((a, b) => Number(a.label === null) - Number(b.label === null)),
    areas,
    stations,
  };
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// Save the roles changed in the matrix — one transaction. The Administrator
// keeps every permission and back-office access (only its home screen can
// change). Permissions must be real ones; the area and station must exist.
export async function saveRoleMatrix(input: RoleMatrixInput, userId: string): Promise<Result<{ changed: number }>> {
  const known = new Set<string>(ALL_PERMISSIONS);
  const bad = input.roles.flatMap((r) => r.permissions).find((p) => !known.has(p));
  if (bad) return { ok: false, error: `“${bad}” isn't a permission.` };
  const areaIds = [...new Set(input.roles.flatMap((r) => (r.homeAreaId ? [r.homeAreaId] : [])))];
  const codes = [...new Set(input.roles.flatMap((r) => (r.homeStation ? [r.homeStation] : [])))];
  const [areas, stations] = await Promise.all([
    areaIds.length ? prisma.diningArea.count({ where: { id: { in: areaIds }, deletedAt: null } }) : 0,
    codes.length ? prisma.kitchenStation.count({ where: { code: { in: codes } } }) : 0,
  ]);
  if (areas !== areaIds.length) return { ok: false, error: "One of those areas has been deleted. Reload the page." };
  if (stations !== codes.length) return { ok: false, error: "One of those kitchen stations has been removed. Reload the page." };

  return prisma.$transaction(async (tx) => {
    let changed = 0;
    for (const row of [...input.roles].sort((a, b) => a.id.localeCompare(b.id))) {
      const role = await tx.role.findFirst({
        where: { id: row.id, deletedAt: null },
        select: { name: true, isSystem: true, accessLevel: true, homeScreen: true, homeAreaId: true, homeStation: true, permissions: { select: { permission: true } } },
      });
      if (!role) return { ok: false as const, error: "One of those roles has been deleted. Reload the page." };
      const wanted = role.isSystem ? [...ALL_PERMISSIONS] : [...new Set(row.permissions)].sort();
      const had = role.permissions.map((p) => p.permission).sort();
      const added = wanted.filter((p) => !had.includes(p));
      const removed = role.isSystem ? [] : had.filter((p) => !wanted.includes(p));
      const accessLevel: AccessLevel = role.isSystem ? "BACK_OFFICE" : row.accessLevel;
      const home = { homeScreen: row.homeScreen, homeAreaId: row.homeAreaId, homeStation: row.homeScreen === "KITCHEN" ? row.homeStation : null };
      const fieldsChanged = accessLevel !== role.accessLevel || home.homeScreen !== role.homeScreen || home.homeAreaId !== role.homeAreaId || home.homeStation !== role.homeStation;
      if (!added.length && !removed.length && !fieldsChanged) continue;
      changed++;
      await tx.role.update({ where: { id: row.id }, data: { accessLevel, ...home } });
      if (removed.length) await tx.rolePermission.deleteMany({ where: { roleId: row.id, permission: { in: removed } } });
      if (added.length && !role.isSystem) await tx.rolePermission.createMany({ data: added.map((permission) => ({ roleId: row.id, permission })), skipDuplicates: true });
      await writeAudit(
        {
          userId,
          action: "role.update",
          entityType: "Role",
          entityId: row.id,
          meta: {
            role: role.name,
            ...(added.length && !role.isSystem ? { added } : {}),
            ...(removed.length ? { removed } : {}),
            ...(accessLevel !== role.accessLevel ? { accessLevel: { from: role.accessLevel, to: accessLevel } } : {}),
            ...(home.homeScreen !== role.homeScreen || home.homeAreaId !== role.homeAreaId || home.homeStation !== role.homeStation
              ? { home: { from: { screen: role.homeScreen, area: role.homeAreaId, station: role.homeStation }, to: { screen: home.homeScreen, area: home.homeAreaId, station: home.homeStation } } }
              : {}),
          },
        },
        tx,
      );
    }
    return { ok: true as const, changed };
  });
}

// Copy role: a custom role with the same permissions, access level and home
// screen (the Administrator's copy gets its every permission written out,
// and isn't itself an Administrator).
export async function copyRole(input: CopyRoleInput, userId: string): Promise<Result<{ id: string }>> {
  const name = input.name.trim();
  return prisma.$transaction(async (tx) => {
    const from = await tx.role.findFirst({
      where: { id: input.fromId, deletedAt: null },
      select: { name: true, isSystem: true, accessLevel: true, homeScreen: true, homeAreaId: true, homeStation: true, permissions: { select: { permission: true } } },
    });
    if (!from) return { ok: false as const, error: "That role has been deleted. Reload the page." };
    // Role names are unique (any case, deleted roles too — the column is).
    const clash = await tx.role.findFirst({ where: { name }, select: { deletedAt: true } });
    if (clash) return { ok: false as const, error: clash.deletedAt ? `A deleted role is still called “${name}”. Pick another name.` : `A role called “${name}” already exists.` };
    const permissions = from.isSystem ? [...ALL_PERMISSIONS] : from.permissions.map((p) => p.permission);
    const role = await tx.role.create({
      data: {
        name,
        accessLevel: from.isSystem ? "BACK_OFFICE" : from.accessLevel,
        homeScreen: from.homeScreen,
        homeAreaId: from.homeAreaId,
        homeStation: from.homeStation,
        permissions: { createMany: { data: permissions.map((permission) => ({ permission })) } },
      },
      select: { id: true },
    });
    await writeAudit({ userId, action: "role.copy", entityType: "Role", entityId: role.id, meta: { from: from.name, to: name, permissions: permissions.length } }, tx);
    return { ok: true as const, id: role.id };
  });
}
