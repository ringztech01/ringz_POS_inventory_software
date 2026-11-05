import "server-only";
import { Prisma, type OrderStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { getBusinessSettings } from "@/lib/business-settings";
import type { ActionFailure } from "../../lib/actionResult";
import { stationFor } from "../../lib/kds";
import { WASTE_REASON_LABEL } from "../../lib/waste";
import type { RemakeInput } from "../../schemas/waste";
import { UPDATED_ELSEWHERE } from "./kitchen";
import { activeStations, NO_ACTIVE_STATION, sendRemakeKot } from "./kots";
import { logWasteInTx, wasteStockRefusal } from "./waste";

// Remake (the kitchen display's line menu) — without the permission check
// and input parsing (../actions/waste.ts). In one transaction:
//   1. the spoilt dishes are logged as waste (Burnt / Dropped), linked to the
//      line — their stock comes out now, at their cost now;
//   2. a remake line is added to the order: the same dish, options and note,
//      at no charge (remakeOfId → the original; never billed, settled,
//      split or refunded, and it takes no stock at settle — step 1 did);
//   3. it's sent straight to the line's station on a ticket of its own,
//      noted "REMAKE: Burnt".
// The original line is untouched and billed once. Nothing is written if any
// step is refused (an approver's PIN over the limit, not enough stock, no
// station on).
//
// LOCK ORDER, as the kitchen's other changes: the line's order row first.
// The order's version goes up (a line was added to it), so a waiter's open
// order screen refreshes; its bill doesn't change.

export type RemakeResult =
  | { ok: true; lineId: string; wasteId: string; costSnapshot: string; station: string }
  | (ActionFailure & { needsApproval?: true; limit?: string; stale?: true });

const LIVE_ORDER: OrderStatus[] = ["OPEN", "SENT", "SERVED"];
const NOT_REMAKEABLE = "Only a dish being made or ready can be remade — refreshed.";

export async function remakeLine(input: RemakeInput, userId: string): Promise<RemakeResult> {
  const settings = await getBusinessSettings();
  const limit = new Decimal(settings.restaurantWasteApprovalLimit.toString());
  try {
    return await prisma.$transaction(
      async (tx): Promise<RemakeResult> => {
        const owner = await tx.orderItem.findUnique({ where: { id: input.itemId }, select: { orderId: true } });
        if (!owner) return { ok: false, error: UPDATED_ELSEWHERE, stale: true };
        await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${owner.orderId} FOR UPDATE`;

        const line = await tx.orderItem.findUniqueOrThrow({
          where: { id: input.itemId },
          select: {
            id: true,
            orderId: true,
            productId: true,
            quantity: true,
            taxType: true,
            modifiers: true,
            note: true,
            stationId: true,
            kitchenStatus: true,
            cancelledAt: true,
            deletedAt: true,
            remakeOfId: true,
            product: { select: { name: true, stationId: true } },
            order: { select: { status: true, deletedAt: true } },
          },
        });
        if (line.cancelledAt || line.deletedAt || line.order.deletedAt || !LIVE_ORDER.includes(line.order.status)) {
          return { ok: false, error: "That dish is no longer on a live order — refreshed.", stale: true };
        }
        if (line.kitchenStatus !== "PREPARING" && line.kitchenStatus !== "READY") return { ok: false, error: NOT_REMAKEABLE, stale: true };
        if (input.qty > line.quantity) return { ok: false, error: `The line has ${line.quantity} — remake at most ${line.quantity}.` };

        // Its station if that's still on; else the dish's, else the first on.
        const stations = await activeStations(tx);
        const station = stations.find((s) => s.id === line.stationId) ?? stations.find((s) => s.id === stationFor(line.product.stationId, stations));
        if (!station) return { ok: false, error: NO_ACTIVE_STATION };

        const waste = await logWasteInTx(
          tx,
          { productId: line.productId, qty: String(input.qty), reason: input.reason, note: input.note, orderItemId: line.id, approval: input.approval },
          userId,
          limit,
          settings.restaurantWarehouseId,
        );
        if (!waste.ok) return waste;

        const now = new Date();
        const remake = await tx.orderItem.create({
          data: {
            orderId: line.orderId,
            productId: line.productId,
            quantity: input.qty,
            unitPrice: 0,
            taxType: line.taxType,
            taxRate: 0,
            modifiers: line.modifiers ?? Prisma.JsonNull,
            note: line.note,
            // A remake of a remake points at the line that's billed.
            remakeOfId: line.remakeOfId ?? line.id,
            kitchenStatus: "PENDING",
            stationId: station.id,
            sentAt: now,
          },
          select: { id: true },
        });
        await sendRemakeKot(tx, remake.id, station.id, userId, `REMAKE: ${WASTE_REASON_LABEL[input.reason]}${input.note ? ` — ${input.note}` : ""}`);
        // A Served order has something cooking again.
        await tx.order.update({
          where: { id: line.orderId },
          data: { version: { increment: 1 }, ...(line.order.status === "SERVED" ? { status: "SENT" } : {}) },
        });
        return { ok: true, lineId: remake.id, wasteId: waste.id, costSnapshot: waste.costSnapshot, station: station.name };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20000 },
    );
  } catch (error) {
    const refused = wasteStockRefusal(error);
    if (refused) return refused;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { ok: false, error: UPDATED_ELSEWHERE, stale: true };
    throw error;
  }
}
