"use server";

import { prisma } from "@/lib/db";
import type { SyncLine } from "../../lib/tabletQueue";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { idSchema } from "../../schemas/common";
import { requirePermission } from "../guard";
import { safely } from "../safely";

// The tablet's add queue (Part 6g Step 6): the order as the server has it
// right now, read before each queued dish is sent — its version, and enough
// of its lines to tell whether a try whose answer was lost got through.
// Reads only. Manage Orders.

export type TabletOrderSync = { ok: true; version: number; lines: SyncLine[] } | { ok: false; error: string };

export async function tabletOrderSync(orderId: unknown): Promise<TabletOrderSync> {
  return safely("tablet order sync", async (): Promise<TabletOrderSync> => {
    const auth = await requirePermission(RESTAURANT_PERMISSIONS.MANAGE_ORDERS);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const parsed = idSchema.safeParse(orderId);
    if (!parsed.success) return { ok: false, error: "That order is no longer here." };
    const order = await prisma.order.findFirst({
      where: { id: parsed.data, deletedAt: null },
      select: { version: true, items: { where: { deletedAt: null }, select: { productId: true, modifiers: true, note: true, quantity: true, cancelledAt: true } } },
    });
    if (!order) return { ok: false, error: "That order is no longer here." };
    return {
      ok: true,
      version: order.version,
      lines: order.items.map((item) => ({
        productId: item.productId,
        modifierIds: Array.isArray(item.modifiers) ? item.modifiers.flatMap((m) => (typeof m === "object" && m !== null && "id" in m && typeof m.id === "string" ? [m.id] : [])) : [],
        note: item.note,
        quantity: item.quantity,
        cancelled: item.cancelledAt !== null,
      })),
    };
  });
}
