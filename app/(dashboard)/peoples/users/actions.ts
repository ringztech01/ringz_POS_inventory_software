"use server";

import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { saveAvatarImage } from "@/lib/uploads";
import { createUserSchema, updateUserSchema } from "@/lib/validations/user";
import type { UserActionState } from "./types";

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

async function requireManageUsers(): Promise<{ error: string } | { error?: undefined }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You must be signed in to do that." };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_USERS)) {
    return { error: "You don't have permission to manage users." };
  }

  return {};
}

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
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { firstName, lastName, email, phoneNumber, password, role } = parsed.data;

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
      role,
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
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { firstName, lastName, email, phoneNumber, password, role } = parsed.data;

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
      role,
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
  // ever again. Count every OTHER non-deleted admin; if there are none,
  // this is the last one.
  if (existing.role === Role.ADMIN) {
    const otherAdminCount = await prisma.user.count({
      where: { role: Role.ADMIN, deletedAt: null, id: { not: id } },
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
