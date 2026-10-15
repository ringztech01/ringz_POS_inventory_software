"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { generateReference } from "@/lib/reference";
import { increaseStock, decreaseStock, InsufficientStockError } from "@/lib/stock";
import { adjustmentSchema } from "@/lib/validations/adjustment";
import type { AdjustmentActionState, AdjustmentProductSearchResult } from "./types";

async function requireManageAdjustments(): Promise<{ error: string } | { error?: undefined }> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You must be signed in to do that." };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_ADJUSTMENTS)) {
    return { error: "You don't have permission to manage adjustments." };
  }

  return {};
}

// Read-only, so only a session is required — no Manage Adjustments check
// here, that's enforced on the actual save/delete mutations.
export async function searchProductsForAdjustment(
  warehouseId: string,
  query: string,
): Promise<AdjustmentProductSearchResult[]> {
  const session = await auth();
  if (!session?.user) {
    return [];
  }

  const trimmed = query.trim();
  if (!warehouseId || trimmed.length === 0) {
    return [];
  }

  const products = await prisma.product.findMany({
    where: {
      deletedAt: null,
      OR: [{ name: { contains: trimmed } }, { code: { contains: trimmed } }],
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
    take: 8,
  });

  if (products.length === 0) {
    return [];
  }

  const stocks = await prisma.productStock.findMany({
    where: { warehouseId, productId: { in: products.map((product) => product.id) } },
    select: { productId: true, quantity: true },
  });
  const stockByProduct = new Map(stocks.map((row) => [row.productId, row.quantity]));

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    code: product.code,
    stock: stockByProduct.get(product.id) ?? 0,
  }));
}

export async function createAdjustment(formData: FormData): Promise<AdjustmentActionState> {
  const authCheck = await requireManageAdjustments();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  let itemsPayload: unknown = [];
  const itemsRaw = formData.get("items");
  if (typeof itemsRaw === "string") {
    try {
      itemsPayload = JSON.parse(itemsRaw);
    } catch {
      return { ok: false, error: "Something went wrong reading the item list. Please try again." };
    }
  }

  const parsed = adjustmentSchema.safeParse({
    warehouseId: formData.get("warehouseId"),
    date: formData.get("date"),
    items: itemsPayload,
  });

  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    return {
      ok: false,
      error: "Please fix the errors below.",
      fieldErrors: {
        warehouseId: flattened.fieldErrors.warehouseId,
        date: flattened.fieldErrors.date,
        items: flattened.fieldErrors.items ?? (flattened.formErrors.length ? flattened.formErrors : undefined),
      },
    };
  }

  const { warehouseId, date, items } = parsed.data;

  // Re-read the warehouse and every product server-side — the client's
  // names, codes and stock numbers are for display only and are never
  // trusted here.
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, deletedAt: null } });
  if (!warehouse) {
    return { ok: false, error: "Warehouse not found.", fieldErrors: { warehouseId: ["Warehouse not found."] } };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((item) => item.productId) }, deletedAt: null },
    select: { id: true, name: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  if (items.some((item) => !productById.has(item.productId))) {
    return { ok: false, error: "One of the selected products could not be found. Please refresh and try again." };
  }

  try {
    // Reference generation, the Adjustment + its items, and every stock
    // movement all happen in one transaction — either the whole adjustment
    // lands or none of it does. decreaseStock throws InsufficientStockError
    // the moment any line would go negative, which rolls everything back.
    await prisma.$transaction(async (tx) => {
      await tx.adjustment.create({
        data: {
          reference: generateReference("ADJ"),
          warehouseId,
          date,
          createdById: session.user.id,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              type: item.type,
            })),
          },
        },
      });

      for (const item of items) {
        const product = productById.get(item.productId)!;

        if (item.type === "ADDITION") {
          await increaseStock(tx, { productId: item.productId, warehouseId, quantity: item.quantity });
        } else {
          await decreaseStock(tx, {
            productId: item.productId,
            warehouseId,
            quantity: item.quantity,
            productName: product.name,
            warehouseName: warehouse.name,
          });
        }
      }
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "That reference number collided with an existing one — please try saving again." };
    }
    throw error;
  }

  revalidatePath("/adjustments");
  revalidatePath("/products");
  for (const item of items) {
    revalidatePath(`/products/${item.productId}`);
  }

  return { ok: true };
}

export async function deleteAdjustment(id: string): Promise<AdjustmentActionState> {
  const authCheck = await requireManageAdjustments();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const existing = await prisma.adjustment.findFirst({
    where: { id, deletedAt: null },
    include: { items: true, warehouse: true },
  });
  if (!existing) {
    return { ok: false, error: "Adjustment not found." };
  }

  const products = await prisma.product.findMany({
    where: { id: { in: existing.items.map((item) => item.productId) } },
    select: { id: true, name: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  try {
    // Deleting an adjustment reverses every line's stock effect — an
    // Addition is reversed by subtracting it back out (which can fail if
    // other activity since then has driven stock too low to absorb that),
    // a Subtraction is reversed by adding it back (always safe). All of it,
    // plus the soft delete itself, happens in one transaction.
    await prisma.$transaction(async (tx) => {
      for (const item of existing.items) {
        const productName = productById.get(item.productId)?.name ?? "Unknown product";

        if (item.type === "ADDITION") {
          await decreaseStock(tx, {
            productId: item.productId,
            warehouseId: existing.warehouseId,
            quantity: item.quantity,
            productName,
            warehouseName: existing.warehouse.name,
          });
        } else {
          await increaseStock(tx, {
            productId: item.productId,
            warehouseId: existing.warehouseId,
            quantity: item.quantity,
          });
        }
      }

      await tx.adjustment.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return { ok: false, error: `Can't delete — reversing this adjustment would go negative. ${error.message}` };
    }
    throw error;
  }

  revalidatePath("/adjustments");
  revalidatePath("/products");
  for (const item of existing.items) {
    revalidatePath(`/products/${item.productId}`);
  }

  return { ok: true };
}
