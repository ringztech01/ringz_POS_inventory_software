"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { saveCategoryLogo } from "@/lib/uploads";
import { categorySchema } from "@/lib/validations/category";
import { countActiveProductsInCategory } from "./queries";
import type { CategoryActionState } from "./types";

async function requireManageProductCategories(): Promise<{ error: string } | { error?: undefined }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You must be signed in to do that." };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_PRODUCT_CATEGORIES)) {
    return { error: "You don't have permission to manage product categories." };
  }

  return {};
}

async function saveUploadedLogo(formData: FormData, idForFilename: string): Promise<{ path?: string; error?: string }> {
  const logoFile = formData.get("logo");
  if (!(logoFile instanceof File) || logoFile.size === 0) {
    return {};
  }

  try {
    return { path: await saveCategoryLogo(logoFile, idForFilename) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the uploaded logo." };
  }
}

export async function createCategory(formData: FormData): Promise<CategoryActionState> {
  const authCheck = await requireManageProductCategories();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const parsed = categorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // No category id exists yet at this point, so the uploaded file is
  // namespaced with a random id instead — saveCategoryLogo only uses it to
  // keep filenames unique, it isn't a foreign key.
  const { path: logoPath, error: logoError } = await saveUploadedLogo(formData, randomUUID());
  if (logoError) {
    return { ok: false, error: logoError };
  }

  await prisma.category.create({
    data: {
      name: parsed.data.name,
      ...(logoPath ? { logo: logoPath } : {}),
    },
  });

  revalidatePath("/product-categories");

  return { ok: true };
}

export async function deleteCategory(id: string): Promise<CategoryActionState> {
  const authCheck = await requireManageProductCategories();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const existing = await prisma.category.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { ok: false, error: "Product category not found." };
  }

  const activeProductCount = await countActiveProductsInCategory(id);
  if (activeProductCount > 0) {
    return {
      ok: false,
      error: `Can't delete — ${activeProductCount} product${activeProductCount === 1 ? "" : "s"} use this category. Reassign them first.`,
    };
  }

  await prisma.category.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/product-categories");

  return { ok: true };
}

export async function updateCategory(id: string, formData: FormData): Promise<CategoryActionState> {
  const authCheck = await requireManageProductCategories();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the target record server-side rather than trusting that the id
  // still refers to a live, non-deleted category by the time this runs.
  const existing = await prisma.category.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { ok: false, error: "Product category not found." };
  }

  const parsed = categorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Keep the existing logo when no new file was uploaded.
  const { path: logoPath, error: logoError } = await saveUploadedLogo(formData, existing.id);
  if (logoError) {
    return { ok: false, error: logoError };
  }

  await prisma.category.update({
    where: { id },
    data: {
      name: parsed.data.name,
      ...(logoPath ? { logo: logoPath } : {}),
    },
  });

  revalidatePath("/product-categories");

  return { ok: true };
}
