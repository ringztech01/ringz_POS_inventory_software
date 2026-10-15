"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { saveBrandLogo } from "@/lib/uploads";
import { brandSchema } from "@/lib/validations/brand";
import { countActiveProductsInBrand } from "./queries";
import type { BrandActionState } from "./types";

async function requireManageProducts(): Promise<{ error: string } | { error?: undefined }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You must be signed in to do that." };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_PRODUCTS)) {
    return { error: "You don't have permission to manage products." };
  }

  return {};
}

async function saveUploadedLogo(formData: FormData, idForFilename: string): Promise<{ path?: string; error?: string }> {
  const logoFile = formData.get("logo");
  if (!(logoFile instanceof File) || logoFile.size === 0) {
    return {};
  }

  try {
    return { path: await saveBrandLogo(logoFile, idForFilename) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the uploaded logo." };
  }
}

export async function createBrand(formData: FormData): Promise<BrandActionState> {
  const authCheck = await requireManageProducts();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const parsed = brandSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // No brand id exists yet at this point, so the uploaded file is
  // namespaced with a random id instead — saveBrandLogo only uses it to
  // keep filenames unique, it isn't a foreign key.
  const { path: logoPath, error: logoError } = await saveUploadedLogo(formData, randomUUID());
  if (logoError) {
    return { ok: false, error: logoError };
  }

  await prisma.brand.create({
    data: {
      name: parsed.data.name,
      ...(logoPath ? { logo: logoPath } : {}),
    },
  });

  revalidatePath("/brands");

  return { ok: true };
}

export async function updateBrand(id: string, formData: FormData): Promise<BrandActionState> {
  const authCheck = await requireManageProducts();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the target record server-side rather than trusting that the id
  // still refers to a live, non-deleted brand by the time this runs.
  const existing = await prisma.brand.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { ok: false, error: "Brand not found." };
  }

  const parsed = brandSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  // Keep the existing logo when no new file was uploaded.
  const { path: logoPath, error: logoError } = await saveUploadedLogo(formData, existing.id);
  if (logoError) {
    return { ok: false, error: logoError };
  }

  await prisma.brand.update({
    where: { id },
    data: {
      name: parsed.data.name,
      ...(logoPath ? { logo: logoPath } : {}),
    },
  });

  revalidatePath("/brands");

  return { ok: true };
}

export async function deleteBrand(id: string): Promise<BrandActionState> {
  const authCheck = await requireManageProducts();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const existing = await prisma.brand.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { ok: false, error: "Brand not found." };
  }

  const activeProductCount = await countActiveProductsInBrand(id);
  if (activeProductCount > 0) {
    return {
      ok: false,
      error: `Can't delete — ${activeProductCount} product${activeProductCount === 1 ? "" : "s"} use this brand. Reassign them first.`,
    };
  }

  await prisma.brand.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/brands");

  return { ok: true };
}
