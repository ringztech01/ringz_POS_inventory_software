"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/permissions.server";
import { warehouseSchema } from "@/lib/validations/warehouse";
import { isWarehouseInUse } from "./queries";
import type { WarehouseActionState } from "./types";

// Permission check (lib/auth/permissions.server.ts): DB-backed, per request.
const requireManageWarehouses = () => requirePermission(PERMISSIONS.MANAGE_WAREHOUSES);

function parseWarehouseFormData(formData: FormData) {
  return warehouseSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phoneNumber: formData.get("phoneNumber"),
    country: formData.get("country"),
    city: formData.get("city"),
    zipCode: formData.get("zipCode"),
  });
}

export async function createWarehouse(formData: FormData): Promise<WarehouseActionState> {
  const authCheck = await requireManageWarehouses();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  const parsed = parseWarehouseFormData(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await prisma.warehouse.create({ data: parsed.data });

  revalidatePath("/warehouse");

  return { status: "success", message: "Warehouse created successfully." };
}

export async function updateWarehouse(id: string, formData: FormData): Promise<WarehouseActionState> {
  const authCheck = await requireManageWarehouses();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  // Re-read the target record server-side rather than trusting that the id
  // still refers to a live, non-deleted warehouse by the time this runs.
  const existing = await prisma.warehouse.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { status: "error", message: "Warehouse not found." };
  }

  const parsed = parseWarehouseFormData(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  await prisma.warehouse.update({
    where: { id },
    data: parsed.data,
  });

  revalidatePath("/warehouse");

  return { status: "success", message: "Warehouse updated successfully." };
}

export async function deleteWarehouse(id: string): Promise<WarehouseActionState> {
  const authCheck = await requireManageWarehouses();
  if (authCheck.error) {
    return { status: "error", message: authCheck.error };
  }

  const existing = await prisma.warehouse.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { status: "error", message: "Warehouse not found." };
  }

  if (await isWarehouseInUse(id)) {
    return { status: "error", message: "This warehouse has related records and can't be deleted." };
  }

  await prisma.warehouse.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/warehouse");

  return { status: "success", message: "Warehouse deleted successfully." };
}
