"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { saveProductImage } from "@/lib/uploads";
import { increaseStock } from "@/lib/stock";
import { productSchema, initialStockSchema } from "@/lib/validations/product";
import { countProductReferences } from "./queries";
import type { ProductActionState } from "./types";

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

async function saveUploadedImages(
  formData: FormData,
  idForFilename: string,
): Promise<{ paths?: string[]; error?: string }> {
  const files = formData.getAll("images").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) {
    return { paths: [] };
  }

  try {
    const paths = await Promise.all(files.map((file, index) => saveProductImage(file, idForFilename, index)));
    return { paths };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not save the uploaded images." };
  }
}

export async function createProduct(formData: FormData): Promise<ProductActionState> {
  const authCheck = await requireManageProducts();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const productParsed = productSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    categoryId: formData.get("categoryId"),
    brandId: formData.get("brandId"),
    unitId: formData.get("unitId"),
    price: formData.get("price"),
    cost: formData.get("cost"),
    stockAlert: formData.get("stockAlert"),
    orderTax: formData.get("orderTax"),
    taxType: formData.get("taxType"),
    quantityLimitation: formData.get("quantityLimitation"),
    notes: formData.get("notes"),
  });

  const stockParsed = initialStockSchema.safeParse({
    warehouseId: formData.get("warehouseId"),
    supplierId: formData.get("supplierId"),
    quantity: formData.get("quantity"),
    status: formData.get("status"),
  });

  if (!productParsed.success || !stockParsed.success) {
    return {
      ok: false,
      error: "Please fix the errors below.",
      fieldErrors: {
        ...(productParsed.success ? {} : productParsed.error.flatten().fieldErrors),
        ...(stockParsed.success ? {} : stockParsed.error.flatten().fieldErrors),
      },
    };
  }

  const product = productParsed.data;
  const stock = stockParsed.data;

  // No product id exists yet at this point, so uploaded images are
  // namespaced with a random id instead — saveProductImage only uses it to
  // keep filenames unique, it isn't a foreign key.
  const { paths: imagePaths, error: imageError } = await saveUploadedImages(formData, randomUUID());
  if (imageError) {
    return { ok: false, error: imageError };
  }

  try {
    // Both inserts succeed together or neither does — a product should never
    // exist without its initial stock row, and vice versa.
    await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: product.name,
          code: product.code,
          categoryId: product.categoryId,
          brandId: product.brandId,
          unitId: product.unitId,
          price: product.price,
          cost: product.cost,
          stockAlert: product.stockAlert,
          orderTax: product.orderTax,
          taxType: product.taxType,
          quantityLimitation: product.quantityLimitation,
          notes: product.notes,
          // The first image is the list thumbnail; images is the full-fidelity
          // array. Left unset (not an empty array) when nothing was uploaded.
          ...(imagePaths && imagePaths.length > 0 ? { images: imagePaths } : {}),
        },
      });

      await increaseStock(tx, {
        productId: created.id,
        warehouseId: stock.warehouseId,
        quantity: stock.quantity,
        supplierId: stock.supplierId,
        status: stock.status,
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        ok: false,
        error: "That code is already in use.",
        fieldErrors: { code: ["That code is already in use."] },
      };
    }
    throw error;
  }

  revalidatePath("/products");

  return { ok: true };
}

export async function updateProduct(id: string, formData: FormData): Promise<ProductActionState> {
  const authCheck = await requireManageProducts();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the target record server-side rather than trusting that the id
  // still refers to a live, non-deleted product by the time this runs.
  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { ok: false, error: "Product not found." };
  }

  const productParsed = productSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    categoryId: formData.get("categoryId"),
    brandId: formData.get("brandId"),
    unitId: formData.get("unitId"),
    price: formData.get("price"),
    cost: formData.get("cost"),
    stockAlert: formData.get("stockAlert"),
    orderTax: formData.get("orderTax"),
    taxType: formData.get("taxType"),
    quantityLimitation: formData.get("quantityLimitation"),
    notes: formData.get("notes"),
  });

  if (!productParsed.success) {
    return { ok: false, error: "Please fix the errors below.", fieldErrors: productParsed.error.flatten().fieldErrors };
  }

  const product = productParsed.data;

  // The client sends back which previously-saved images it kept (the user
  // may have removed some via the X button); anything newly uploaded here
  // gets appended after them. This is the full reconciliation — we never
  // partially patch the images array.
  let keptImages: string[] = [];
  const existingImagesRaw = formData.get("existingImages");
  if (typeof existingImagesRaw === "string") {
    try {
      const parsed: unknown = JSON.parse(existingImagesRaw);
      if (Array.isArray(parsed)) {
        keptImages = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      // Malformed payload — treat as if nothing was kept rather than failing
      // the whole update over a client-side bug in the image list.
    }
  }

  const { paths: newImagePaths, error: imageError } = await saveUploadedImages(formData, existing.id);
  if (imageError) {
    return { ok: false, error: imageError };
  }

  const finalImages = [...keptImages, ...(newImagePaths ?? [])];

  try {
    // Critical: unlike createProduct, this never touches ProductStock. The
    // create-time "Add stock" logic must not run again here — re-running it
    // on every edit would silently add more quantity each time the product
    // is saved. Stock only ever changes through Adjustments/Purchases.
    await prisma.product.update({
      where: { id },
      data: {
        name: product.name,
        code: product.code,
        categoryId: product.categoryId,
        brandId: product.brandId,
        unitId: product.unitId,
        price: product.price,
        // null (not undefined) so clearing the field on edit actually clears it.
        cost: product.cost ?? null,
        stockAlert: product.stockAlert,
        orderTax: product.orderTax,
        taxType: product.taxType,
        quantityLimitation: product.quantityLimitation,
        notes: product.notes,
        images: finalImages.length > 0 ? finalImages : Prisma.JsonNull,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        ok: false,
        error: "That code is already in use.",
        fieldErrors: { code: ["That code is already in use."] },
      };
    }
    throw error;
  }

  revalidatePath("/products");
  revalidatePath(`/products/${id}`);

  return { ok: true };
}

export async function deleteProduct(id: string): Promise<ProductActionState> {
  const authCheck = await requireManageProducts();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const existing = await prisma.product.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return { ok: false, error: "Product not found." };
  }

  const referenceCount = await countProductReferences(id);
  if (referenceCount > 0) {
    return {
      ok: false,
      error: `Can't delete — this product is used in ${referenceCount} purchases/sales/transfers.`,
    };
  }

  await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/products");

  return { ok: true };
}
