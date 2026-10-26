"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/permissions.server";
import { supplierSchema } from "@/lib/validations/supplier";
import { isSupplierInUse } from "./queries";
import type { SupplierActionState } from "./types";

// Permission check (lib/auth/permissions.server.ts): DB-backed, per request.
const requireManageSuppliers = () => requirePermission(PERMISSIONS.MANAGE_SUPPLIERS);

function parseSupplierFormData(formData: FormData) {
  return supplierSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phoneNumber: formData.get("phoneNumber"),
    country: formData.get("country"),
    city: formData.get("city"),
    address: formData.get("address"),
  });
}

export async function createSupplier(formData: FormData): Promise<SupplierActionState> {
  const authCheck = await requireManageSuppliers();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  const parsed = parseSupplierFormData(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await prisma.supplier.create({ data: parsed.data });

  revalidatePath("/peoples/suppliers");

  return { status: "success", message: "Supplier created successfully." };
}

export async function updateSupplier(id: string, formData: FormData): Promise<SupplierActionState> {
  const authCheck = await requireManageSuppliers();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  // Re-read the target record server-side rather than trusting that the id
  // still refers to a live, non-deleted supplier by the time this runs.
  const existing = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { status: "error", message: "Supplier not found." };
  }

  const parsed = parseSupplierFormData(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await prisma.supplier.update({
    where: { id },
    data: parsed.data,
  });

  revalidatePath("/peoples/suppliers");

  return { status: "success", message: "Supplier updated successfully." };
}

export async function deleteSupplier(id: string): Promise<SupplierActionState> {
  const authCheck = await requireManageSuppliers();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  const existing = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { status: "error", message: "Supplier not found." };
  }

  if (await isSupplierInUse(id)) {
    return { status: "error", message: "This supplier has related purchases and can't be deleted." };
  }

  await prisma.supplier.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/peoples/suppliers");

  return { status: "success", message: "Supplier deleted successfully." };
}
