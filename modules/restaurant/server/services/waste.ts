import "server-only";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import { formatNaira } from "@/lib/format";
import { decreaseStock, increaseStock, InsufficientStockError } from "@/lib/stock";
import { notEnoughStock } from "@/app/(dashboard)/sales/save-sale";
import type { ActionFailure } from "../../lib/actionResult";
import { planWaste, type WasteItem, type WastePlan } from "../../lib/waste";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import type { LogWasteInput, VoidWasteInput } from "../../schemas/waste";
import { checkApproverPin } from "./approvalPins";

// Waste — without the permission check and input parsing (../actions/
// waste.ts). Not a sale and not a refund: its own stock document. Logging
// takes the item's stock lines (lib/waste.ts) out of the warehouse with
// retail's decreaseStock — its rule: never below zero — and keeps them, with
// their cost then, on the entry. Entries never change: a mistake is undone by
// a VOID entry that puts exactly those saved lines back.

export const WASTE_GONE = "That waste entry is no longer there — refreshed.";
export const WASTE_ITEM_GONE = "That item is no longer on the menu or in the ingredients.";

export type LogWasteResult = { ok: true; id: string; costSnapshot: string } | (ActionFailure & { needsApproval?: true; limit?: string });
export type VoidWasteResult = { ok: true; id: string; version: number } | (ActionFailure & { stale?: true });

const money = (value: Decimal) => formatNaira(value.toFixed(2));
const ACTIVE = { deletedAt: null } as const;

// The item as lib/waste.ts plans it: its type and cost, and — a menu item —
// its live recipe with each ingredient's cost now. Null: missing or deleted.
export async function loadWasteItem(db: Prisma.TransactionClient, productId: string): Promise<{ item: WasteItem; unit: string } | null> {
  const product = await db.product.findFirst({
    where: { id: productId, ...ACTIVE },
    select: {
      id: true,
      name: true,
      productType: true,
      cost: true,
      unit: { select: { name: true } },
      recipeLines: { where: ACTIVE, orderBy: { createdAt: "asc" }, select: { ingredientId: true, quantity: true, ingredient: { select: { name: true, cost: true } } } },
    },
  });
  if (!product) return null;
  return {
    unit: product.unit.name,
    item: {
      id: product.id,
      name: product.name,
      productType: product.productType,
      cost: product.cost?.toString() ?? null,
      recipe:
        product.productType === "MENU_ITEM"
          ? product.recipeLines.map((r) => ({ ingredientId: r.ingredientId, ingredientName: r.ingredient.name, quantity: r.quantity.toString(), cost: r.ingredient.cost?.toString() ?? null }))
          : [],
    },
  };
}

// Where the waste comes out of: an order line's order's warehouse (where its
// stock is); otherwise the restaurant's (the setting — or, not set, the
// first dining area's).
async function wasteWarehouse(db: Prisma.TransactionClient, settingId: string | null, orderItemId: string | undefined, productId: string) {
  if (orderItemId) {
    const line = await db.orderItem.findFirst({
      where: { id: orderItemId, ...ACTIVE, order: ACTIVE },
      select: { productId: true, order: { select: { warehouse: { select: { id: true, name: true } } } } },
    });
    if (!line) return { ok: false as const, error: "That order line is no longer there — refreshed." };
    if (line.productId !== productId) return { ok: false as const, error: "That order line is for another dish." };
    return { ok: true as const, warehouse: line.order.warehouse };
  }
  const id = settingId ?? (await db.diningArea.findFirst({ where: ACTIVE, orderBy: { createdAt: "asc" }, select: { warehouseId: true } }))?.warehouseId;
  const warehouse = id ? await db.warehouse.findUnique({ where: { id }, select: { id: true, name: true } }) : null;
  if (!warehouse) return { ok: false as const, error: "The restaurant has no warehouse to take waste out of. Add a dining area first." };
  return { ok: true as const, warehouse };
}

// The plan for wasting an item, no writes: its lines and cost, and whether
// that needs an approver (more than the limit; a limit of 0: never).
export async function previewWaste(productId: string, qty: string): Promise<(WastePlan & { unit?: string; needsApproval?: boolean; limit?: string }) | { ok: false; error: string }> {
  const [loaded, settings] = await Promise.all([loadWasteItem(prisma, productId), getBusinessSettings()]);
  if (!loaded) return { ok: false, error: WASTE_ITEM_GONE };
  const plan = planWaste(loaded.item, qty);
  if (!plan.ok) return plan;
  const limit = new Decimal(settings.restaurantWasteApprovalLimit.toString());
  return { ...plan, unit: loaded.unit, needsApproval: limit.greaterThan(0) && plan.total.greaterThan(limit), limit: money(limit) };
}

// The Log waste form's live preview (previewWaste, as plain values): the
// cost, what comes out of stock, and whether an approver's PIN is needed.
export type WasteCostPreview =
  | { ok: true; total: string; unit: string; lines: { name: string; qty: string; unit: string }[]; needsApproval: boolean; limit: string }
  | ActionFailure;

export async function wasteCostPreview(productId: string, qty: string): Promise<WasteCostPreview> {
  const preview = await previewWaste(productId, qty);
  if (!preview.ok) return { ok: false, error: preview.error };
  const units = await prisma.product.findMany({ where: { id: { in: preview.lines.map((l) => l.productId) } }, select: { id: true, unit: { select: { name: true } } } });
  const unitOf = new Map(units.map((p) => [p.id, p.unit.name]));
  return {
    ok: true,
    total: preview.total.toFixed(2),
    unit: preview.unit ?? "",
    lines: preview.lines.map((line) => ({ name: line.productName, qty: line.qty.toString(), unit: unitOf.get(line.productId) ?? "" })),
    needsApproval: !!preview.needsApproval,
    limit: preview.limit ?? "",
  };
}

// What log waste takes: the form's input, with the unit optional — left out
// (Remake, returned by guest), it's the item's own.
export type WasteLogInput = Omit<LogWasteInput, "unit"> & { unit?: string };

// Log waste inside the caller's transaction: the item checked (a menu item
// or an ingredient, not deleted, in its own unit), its lines and their cost
// worked out now (lib/waste.ts), the approver's PIN when the cost is above
// the limit (Approve Waste), the stock out — every line, or nothing: retail's
// decreaseStock refuses to go below zero by throwing InsufficientStockError,
// which rolls the caller's whole transaction back (wasteStockRefusal turns
// it into the message) — and the entry with its lines.
export async function logWasteInTx(tx: Prisma.TransactionClient, input: WasteLogInput, userId: string, limit: Decimal, warehouseSettingId: string | null): Promise<LogWasteResult> {
  const loaded = await loadWasteItem(tx, input.productId);
  if (!loaded) return { ok: false, error: WASTE_ITEM_GONE };
  if (input.unit !== undefined && input.unit !== loaded.unit) return { ok: false, error: `${loaded.item.name} is counted in ${loaded.unit} — log it in ${loaded.unit}.` };
  const where = await wasteWarehouse(tx, warehouseSettingId, input.orderItemId, input.productId);
  if (!where.ok) return where;
  const plan = planWaste(loaded.item, input.qty);
  if (!plan.ok) return plan;

  let approvedById: string | null = null;
  if (limit.greaterThan(0) && plan.total.greaterThan(limit)) {
    if (!input.approval) return { ok: false, error: `Waste over ${money(limit)} needs an approver's PIN.`, needsApproval: true, limit: money(limit) };
    const approved = await checkApproverPin(tx, input.approval.approverId, input.approval.pin, RESTAURANT_PERMISSIONS.APPROVE_WASTE);
    if (!approved.ok) return approved;
    approvedById = input.approval.approverId;
  }

  for (const line of plan.lines) {
    await decreaseStock(tx, { productId: line.productId, warehouseId: where.warehouse.id, quantity: line.qty.toNumber(), productName: line.productName, warehouseName: where.warehouse.name });
  }
  const entry = await tx.wasteEntry.create({
    data: {
      warehouseId: where.warehouse.id,
      productId: input.productId,
      qty: input.qty,
      unit: loaded.unit,
      reason: input.reason,
      note: input.note || null,
      costSnapshot: plan.total.toFixed(2),
      orderItemId: input.orderItemId ?? null,
      loggedById: userId,
      approvedById,
      lines: { create: plan.lines.map((line) => ({ productId: line.productId, qty: line.qty.toString(), unitCost: line.unitCost.toFixed(2), lineCost: line.lineCost.toFixed(2) })) },
    },
    select: { id: true },
  });
  return { ok: true, id: entry.id, costSnapshot: plan.total.toFixed(2) };
}

// Not enough stock for a waste line (thrown by decreaseStock): the refusal
// to show, or null for any other error.
export function wasteStockRefusal(error: unknown): ActionFailure | null {
  if (!(error instanceof InsufficientStockError)) return null;
  const refused = notEnoughStock(error);
  return { ok: false, error: (!refused.ok && refused.error) || "Not enough stock." };
}

// Log waste (Food › Waste, the kitchen display's Log waste), in its own
// transaction.
export async function logWasteEntry(input: WasteLogInput, userId: string): Promise<LogWasteResult> {
  const settings = await getBusinessSettings();
  const limit = new Decimal(settings.restaurantWasteApprovalLimit.toString());
  try {
    return await prisma.$transaction((tx) => logWasteInTx(tx, input, userId, limit, settings.restaurantWarehouseId), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: 20000,
    });
  } catch (error) {
    const refused = wasteStockRefusal(error);
    if (refused) return refused;
    throw error;
  }
}

// Void a waste entry, in one transaction: the entry locked and checked
// (ACTIVE, not itself a VOID entry, the version its screen showed), its
// saved lines put back into the same warehouse — exactly those, never worked
// out again — a VOID entry written with the same lines (voidOfId → the entry,
// unique: an entry is voided once), and the entry marked VOID.
export async function voidWasteEntry(input: VoidWasteInput, userId: string): Promise<VoidWasteResult> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<VoidWasteResult> => {
        const rows = await tx.$queryRaw<{ status: string; version: number; voidOfId: string | null }[]>`
          SELECT status, version, voidOfId FROM WasteEntry WHERE id = ${input.id} AND deletedAt IS NULL FOR UPDATE`;
        const head = rows[0];
        if (!head) return { ok: false, error: WASTE_GONE, stale: true };
        if (head.voidOfId) return { ok: false, error: "That's a VOID entry — it can't be voided itself." };
        if (head.status !== "ACTIVE") return { ok: false, error: "That waste entry has already been voided — refreshed.", stale: true };
        if (head.version !== input.version) return { ok: false, error: "That waste entry was changed by someone else — refreshed.", stale: true };

        const entry = await tx.wasteEntry.findUniqueOrThrow({ where: { id: input.id }, include: { lines: { orderBy: { productId: "asc" } } } });
        for (const line of entry.lines) await increaseStock(tx, { productId: line.productId, warehouseId: entry.warehouseId, quantity: line.qty.toNumber() });
        const voiding = await tx.wasteEntry.create({
          data: {
            businessId: entry.businessId,
            warehouseId: entry.warehouseId,
            productId: entry.productId,
            qty: entry.qty,
            unit: entry.unit,
            reason: entry.reason,
            note: entry.note,
            costSnapshot: entry.costSnapshot,
            orderItemId: entry.orderItemId,
            loggedById: userId,
            status: "VOID",
            voidOfId: entry.id,
            voidReason: input.reason,
            lines: { create: entry.lines.map((line) => ({ productId: line.productId, qty: line.qty, unitCost: line.unitCost, lineCost: line.lineCost })) },
          },
          select: { id: true },
        });
        const { version } = await tx.wasteEntry.update({ where: { id: entry.id }, data: { status: "VOID", version: { increment: 1 } }, select: { version: true } });
        return { ok: true, id: voiding.id, version };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 },
    );
  } catch (error) {
    // Voided at the same moment elsewhere: the unique voidOfId stops a second VOID entry.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return { ok: false, error: "That waste entry has already been voided — refreshed.", stale: true };
    }
    throw error;
  }
}
