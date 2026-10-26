"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ALL_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";
import { getCurrentUserPermissions, requirePermission } from "@/lib/auth/permissions.server";
import { roleSchema } from "@/lib/validations/role";
import type { RoleActionState, RoleFieldName } from "./types";

const LIST_PATH = "/roles";
const requireManageRoles = () => requirePermission(PERMISSIONS.MANAGE_ROLES);

// The role was deleted between the re-read and the update.
class RoleGoneError extends Error {}

function invalid(fieldErrors: Partial<Record<RoleFieldName, string[]>>): RoleActionState {
  return { ok: false, error: "Please fix the errors below.", fieldErrors };
}

const nameTaken = () => invalid({ name: ["A role with this name already exists."] });
// Role.name is unique across ALL rows, so a soft-deleted role still holds
// its name.
const nameHeldByDeleted = () =>
  invalid({ name: ["A deleted role still uses this name. Choose a different name."] });

const isNameCollision = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === "P2002" &&
  JSON.stringify(error.meta?.target ?? "").includes("name");

// Another role with this name? Active → "already exists"; soft-deleted →
// the unique index would reject it anyway, so say why. (MySQL's collation
// makes this case-insensitive.)
async function nameCheck(name: string, exceptId?: string): Promise<RoleActionState | null> {
  const clash = await prisma.role.findFirst({
    where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { deletedAt: true },
  });
  if (!clash) return null;
  return clash.deletedAt ? nameHeldByDeleted() : nameTaken();
}

function parse(input: unknown) {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "invalid" as const,
      state: invalid(parsed.error.flatten().fieldErrors as Partial<Record<RoleFieldName, string[]>>),
    };
  }
  return { kind: "ok" as const, data: parsed.data };
}

export async function createRole(input: unknown): Promise<RoleActionState> {
  const authCheck = await requireManageRoles();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  const parsed = parse(input);
  if (parsed.kind === "invalid") return parsed.state;
  const { name, permissions } = parsed.data;

  const clash = await nameCheck(name);
  if (clash) return clash;

  try {
    // The role and its permission rows together.
    await prisma.$transaction(async (tx) => {
      await tx.role.create({
        data: { name, permissions: { create: permissions.map((permission) => ({ permission })) } },
      });
    });
  } catch (error) {
    // Two creates with the same name at once — the unique index catches it.
    if (isNameCollision(error)) return nameTaken();
    throw error;
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function updateRole(id: string, input: unknown): Promise<RoleActionState> {
  const authCheck = await requireManageRoles();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the role server-side; only its id came from the client (and the
  // page binds it).
  const existing = await prisma.role.findFirst({ where: { id, deletedAt: null }, select: { id: true, isSystem: true } });
  if (!existing) {
    return { ok: false, error: "Role not found. It may have been deleted." };
  }

  const parsed = parse(input);
  if (parsed.kind === "invalid") return parsed.state;
  const { name } = parsed.data;

  // LOCKOUT GUARDS
  //   - The isSystem admin role always keeps every permission, whatever was
  //     submitted (its checkboxes render locked).
  //   - Nobody may remove Manage Roles from their OWN role — they'd lose
  //     access to this page with no way back.
  const permissions = existing.isSystem ? ALL_PERMISSIONS : parsed.data.permissions;
  if (!existing.isSystem && !permissions.includes(PERMISSIONS.MANAGE_ROLES)) {
    const current = await getCurrentUserPermissions();
    if (current.roleId === id) {
      return { ok: false, error: "You'd lose access to Roles." };
    }
  }

  const clash = await nameCheck(name, id);
  if (clash) return clash;

  try {
    // One transaction: rename (only while still active), then sync the
    // permission rows by difference — delete the unchecked ones, insert the
    // newly checked ones; rows that stay checked are left alone.
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.role.updateMany({ where: { id, deletedAt: null }, data: { name } });
      if (count === 0) throw new RoleGoneError();

      await tx.rolePermission.deleteMany({ where: { roleId: id, permission: { notIn: permissions } } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: id, permission })),
          skipDuplicates: true,
        });
      }
    });
  } catch (error) {
    if (error instanceof RoleGoneError) return { ok: false, error: "Role not found. It may have been deleted." };
    if (isNameCollision(error)) return nameTaken();
    throw error;
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}


// Soft delete — never a hard delete. Refused for the isSystem admin role, and
// while any ACTIVE user still has the role (they'd be left with no
// permissions); reassign them first.
export async function deleteRole(id: string): Promise<RoleActionState> {
  const authCheck = await requireManageRoles();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the role server-side; only its id came from the client.
  const role = await prisma.role.findFirst({ where: { id, deletedAt: null }, select: { isSystem: true } });
  if (!role) {
    return { ok: false, error: "Role not found. It may have already been deleted." };
  }
  if (role.isSystem) {
    return { ok: false, error: "Can't delete — the Administrator role is built in." };
  }

  const assigned = await prisma.user.count({ where: { roleId: id, deletedAt: null } });
  if (assigned > 0) {
    return {
      ok: false,
      error: `Can't delete — ${assigned} ${assigned === 1 ? "user has" : "users have"} this role. Reassign them first.`,
    };
  }

  // Conditional on still being active, so a double-click or a concurrent
  // delete reports "not found" instead of re-stamping deletedAt.
  const { count } = await prisma.role.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (count === 0) {
    return { ok: false, error: "Role not found. It may have already been deleted." };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}
