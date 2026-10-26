"use server";

import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/permissions.server";
import { saveAvatarImage } from "@/lib/uploads";
import { createUserSchema, updateUserSchema } from "@/lib/validations/user";
import type { UserActionState } from "./types";

// Re-read the chosen role server-side: it must exist and be active.
async function findActiveRole(roleId: string) {
  return prisma.role.findFirst({ where: { id: roleId, deletedAt: null }, select: { id: true } });
}

async function saveUploadedImage(formData: FormData, idForFilename: string): Promise<{ path?: string; error?: string }> {
  const imageFile = formData.get("image");
  if (!(imageFile instanceof File) || imageFile.size === 0) {
    return {};
  }

  try {
    return { path: await saveAvatarImage(imageFile, idForFilename) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the uploaded image." };
  }
}

// Permission check (lib/auth/permissions.server.ts): DB-backed, per request.
const requireManageUsers = () => requirePermission(PERMISSIONS.MANAGE_USERS);

export async function createUser(formData: FormData): Promise<UserActionState> {
  const authCheck = await requireManageUsers();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  const parsed = createUserSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phoneNumber: formData.get("phoneNumber"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { firstName, lastName, email, phoneNumber, password, roleId } = parsed.data;

  if (!(await findActiveRole(roleId))) {
    return { status: "error", message: "That role no longer exists. Choose another one." };
  }

  // Checked against every user regardless of soft-delete status: the email
  // column has a hard unique constraint at the DB level that isn't aware of
  // deletedAt, so a soft-deleted user's email is still unavailable for reuse.
  const existingWithEmail = await prisma.user.findUnique({ where: { email } });
  if (existingWithEmail) {
    return { status: "error", message: "That email is already in use." };
  }

  // No user id exists yet at this point, so the uploaded file is namespaced
  // with a random id instead — saveAvatarImage only uses it to keep
  // filenames unique, it isn't a foreign key.
  const { path: imagePath, error: imageError } = await saveUploadedImage(formData, randomUUID());
  if (imageError) {
    return { status: "error", message: imageError };
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      firstName,
      lastName,
      email,
      phoneNumber,
      password: hashedPassword,
      roleId,
      ...(imagePath ? { image: imagePath } : {}),
    },
  });

  revalidatePath("/peoples/users");

  return { status: "success", message: "User created successfully." };
}

export async function updateUser(id: string, formData: FormData): Promise<UserActionState> {
  const authCheck = await requireManageUsers();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  // Re-read the target record server-side rather than trusting that the id
  // still refers to a live, non-deleted user by the time this runs.
  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { status: "error", message: "User not found." };
  }

  const parsed = updateUserSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phoneNumber: formData.get("phoneNumber"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { firstName, lastName, email, phoneNumber, password, roleId } = parsed.data;

  if (!(await findActiveRole(roleId))) {
    return { status: "error", message: "That role no longer exists. Choose another one." };
  }

  // Demoting the last admin (moving them off the isSystem Administrator role)
  // is refused, like deleting them: someone must always be able to manage
  // Users and Roles.
  const adminRole = await prisma.role.findFirst({ where: { isSystem: true }, select: { id: true } });
  if (adminRole && existing.roleId === adminRole.id && roleId !== adminRole.id) {
    const otherAdminCount = await prisma.user.count({
      where: { roleId: adminRole.id, deletedAt: null, id: { not: id } },
    });
    if (otherAdminCount === 0) {
      return { status: "error", message: "The last remaining admin can't be moved off the Administrator role." };
    }
  }

  if (email !== existing.email) {
    // Checked against every user regardless of soft-delete status — see the
    // same note in createUser.
    const existingWithEmail = await prisma.user.findUnique({ where: { email } });
    if (existingWithEmail) {
      return { status: "error", message: "That email is already in use." };
    }
  }

  const { path: imagePath, error: imageError } = await saveUploadedImage(formData, existing.id);
  if (imageError) {
    return { status: "error", message: imageError };
  }

  // Password is optional on edit: blank means "keep the existing password".
  // Only re-hash and update it when a new one was actually entered.
  const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;

  await prisma.user.update({
    where: { id },
    data: {
      firstName,
      lastName,
      email,
      phoneNumber,
      roleId,
      ...(hashedPassword ? { password: hashedPassword } : {}),
      ...(imagePath ? { image: imagePath } : {}),
    },
  });

  revalidatePath("/peoples/users");

  return { status: "success", message: "User updated successfully." };
}

export async function deleteUser(id: string): Promise<UserActionState> {
  const authCheck = await requireManageUsers();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  const session = await auth();

  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { status: "error", message: "User not found." };
  }

  // A user can never delete their own account — otherwise an admin could
  // lock themselves (and potentially everyone else) out by accident.
  if (session?.user?.id === id) {
    return { status: "error", message: "You can't delete your own account." };
  }

  // The last remaining admin can never be deleted — without at least one
  // admin, no one could manage Users, Roles, or anything else admin-only
  // ever again. "Admin" = assigned the isSystem (Administrator) role. Count
  // every OTHER non-deleted admin; if there are none, this is the last one.
  const adminRole = await prisma.role.findFirst({ where: { isSystem: true }, select: { id: true } });
  if (adminRole && existing.roleId === adminRole.id) {
    const otherAdminCount = await prisma.user.count({
      where: { roleId: adminRole.id, deletedAt: null, id: { not: id } },
    });

    if (otherAdminCount === 0) {
      return { status: "error", message: "The last remaining admin can't be deleted." };
    }
  }

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/peoples/users");

  return { status: "success", message: "User deleted successfully." };
}
