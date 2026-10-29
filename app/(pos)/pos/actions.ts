"use server";

import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/permissions.server";
import { todayInAppZone } from "@/lib/dateRanges";
import { saveNewSale } from "@/app/(dashboard)/sales/save-sale";
import type { PurchaseActionState } from "@/app/(dashboard)/purchases/types";
import { getPosCatalog, isActiveWarehouse } from "./queries";
import { posCheckoutToSaleInput } from "./sale-input";
import type { PosProduct } from "./types";

const requirePos = () => requirePermission(PERMISSIONS.MANAGE_POS_SCREEN);

// The grid for another warehouse (the warehouse selector), and the stock
// refresh after a payment. Manage Pos Screen, like the page.
export async function loadPosProducts(
  warehouseId: string,
): Promise<{ ok: true; products: PosProduct[] } | { ok: false; error: string }> {
  const authCheck = await requirePos();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }
  if (typeof warehouseId !== "string" || !(await isActiveWarehouse(warehouseId))) {
    return { ok: false, error: "That warehouse no longer exists." };
  }
  return { ok: true, products: await getPosCatalog(warehouseId) };
}

// Pay Now: the cart becomes a Sale through the SAME path as the Sales form
// (saveNewSale — validation, lib/pricing.ts totals, the no-oversell stock
// check and decrement, the first payment, the SA_ reference, all in one
// transaction). Only the permission differs: Manage Pos Screen here, Manage
// Sale on createSale.
export async function createPosSale(checkout: unknown): Promise<PurchaseActionState> {
  const authCheck = await requirePos();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }
  return saveNewSale(posCheckoutToSaleInput(checkout, todayInAppZone()), authCheck.userId);
}
