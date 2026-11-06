"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";

// A scan on a back-office page: the product with that code (Manage
// Products, like the product pages it opens). Never throws.

const codeSchema = z.string().trim().min(1).max(128);

export async function findProductByCode(code: unknown): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  try {
    const auth = await requirePermission(PERMISSIONS.MANAGE_PRODUCTS);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = codeSchema.safeParse(code);
    if (!parsed.success) return { ok: false, error: "That scan wasn't a product code." };
    const product = await prisma.product.findFirst({ where: { code: parsed.data, deletedAt: null }, select: { id: true, name: true } });
    return product ? { ok: true, ...product } : { ok: false, error: `No product with code ${parsed.data}.` };
  } catch (error) {
    console.error("[scan] product lookup failed:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
