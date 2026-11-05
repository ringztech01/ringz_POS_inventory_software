import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isTicketDone, modifiersText, stationFor } from "../../lib/kds";

// Kitchen order tickets (KOTs) — always inside the caller's transaction, on
// an order it has already locked. A KOT is never edited after it's made,
// apart from its print count and bump time.

export const NO_ACTIVE_STATION = "No kitchen station is switched on. Turn one on in Stations settings, then send again.";

export type SentToStation = { station: string; count: number };

// Active stations in station order: the first one takes lines whose dish
// has no (active) station.
export function activeStations(tx: Prisma.TransactionClient) {
  return tx.kitchenStation.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
}

const kotLineSelect = {
  id: true,
  quantity: true,
  modifiers: true,
  note: true,
  product: { select: { name: true, stationId: true } },
} satisfies Prisma.OrderItemSelect;

type KotSource = Prisma.OrderItemGetPayload<{ select: typeof kotLineSelect }>;

const snapshot = (line: KotSource) => ({
  orderItemId: line.id,
  name: line.product.name,
  quantity: line.quantity,
  modifiers: modifiersText(line.modifiers),
  note: line.note,
});

// Send to kitchen's part: the order's New lines, grouped by station, become
// one NEW KOT per station (with snapshot lines) and are set to Sent with
// their station and sent time. Nothing to send → nothing sent.
export async function sendNewLines(
  tx: Prisma.TransactionClient,
  orderId: string,
  userId: string,
): Promise<{ ok: true; sent: SentToStation[] } | { ok: false; error: string }> {
  const lines = await tx.orderItem.findMany({
    where: { orderId, kitchenStatus: "NEW", deletedAt: null, cancelledAt: null },
    select: kotLineSelect,
    orderBy: { createdAt: "asc" },
  });
  if (lines.length === 0) return { ok: true, sent: [] };
  const stations = await activeStations(tx);
  if (stations.length === 0) return { ok: false, error: NO_ACTIVE_STATION };

  const byStation = new Map<string, KotSource[]>();
  for (const line of lines) {
    const stationId = stationFor(line.product.stationId, stations)!;
    byStation.set(stationId, [...(byStation.get(stationId) ?? []), line]);
  }

  const now = new Date();
  const sent: SentToStation[] = [];
  for (const station of stations) {
    const group = byStation.get(station.id);
    if (!group) continue;
    await tx.kot.create({
      data: { type: "NEW", orderId, stationId: station.id, createdById: userId, createdAt: now, lines: { create: group.map(snapshot) } },
    });
    await tx.orderItem.updateMany({
      where: { id: { in: group.map((line) => line.id) }, kitchenStatus: "NEW" },
      data: { kitchenStatus: "PENDING", stationId: station.id, sentAt: now },
    });
    sent.push({ station: station.name, count: group.length });
  }
  return { ok: true, sent };
}

// Remake's part: the remake line (already Sent at `stationId`) gets a NEW
// KOT of its own for that station, noted "REMAKE: Burnt" — a ticket on the
// board like any other.
export async function sendRemakeKot(tx: Prisma.TransactionClient, remakeLineId: string, stationId: string, userId: string, note: string): Promise<void> {
  const line = await tx.orderItem.findUniqueOrThrow({ where: { id: remakeLineId }, select: { ...kotLineSelect, orderId: true } });
  await tx.kot.create({ data: { type: "NEW", orderId: line.orderId, stationId, createdById: userId, note, lines: { create: [snapshot(line)] } } });
}

// Cancel line's part: a line that had been sent gets a VOID KOT for its
// station, noted "VOID: <reason>", so the kitchen stops making it.
export async function createVoidKot(tx: Prisma.TransactionClient, lineId: string, userId: string, reason: string): Promise<void> {
  const line = await tx.orderItem.findUniqueOrThrow({ where: { id: lineId }, select: { ...kotLineSelect, orderId: true, stationId: true } });
  // Its station, else (a line sent before stations existed) the first
  // active one, else any station at all.
  const stationId =
    line.stationId ??
    stationFor(line.product.stationId, await activeStations(tx)) ??
    (await tx.kitchenStation.findFirst({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true } }))?.id;
  if (!stationId) return;
  await tx.kot.create({
    data: { type: "VOID", orderId: line.orderId, stationId, createdById: userId, note: `VOID: ${reason}`, lines: { create: [snapshot(line)] } },
  });
}

// After any line change: each NEW ticket holding one of these lines is
// bumped (bumpedAt set) once every live line on it is Ready or Served, and
// un-bumped (cleared) otherwise.
export async function syncKotBump(tx: Prisma.TransactionClient, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  const kots = await tx.kot.findMany({
    where: { type: "NEW", lines: { some: { orderItemId: { in: [...itemIds] } } } },
    select: { id: true, bumpedAt: true, lines: { select: { orderItem: { select: { kitchenStatus: true, cancelledAt: true, deletedAt: true } } } } },
  });
  const now = new Date();
  for (const kot of kots) {
    const done = isTicketDone(kot.lines.map((line) => line.orderItem));
    if (done && !kot.bumpedAt) await tx.kot.update({ where: { id: kot.id }, data: { bumpedAt: now } });
    if (!done && kot.bumpedAt) await tx.kot.update({ where: { id: kot.id }, data: { bumpedAt: null } });
  }
}

export type PrintResult = { ok: true; printCount: number } | { ok: false; error: string };

// Print KOT (its own transaction): one more print on the ticket — REPRINT #n
// from the second print on.
export async function registerPrint(kotId: string): Promise<PrintResult> {
  return prisma.$transaction(async (tx): Promise<PrintResult> => {
    const updated = await tx.kot.updateMany({ where: { id: kotId }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
    if (updated.count === 0) return { ok: false, error: "That ticket no longer exists." };
    const { printCount } = await tx.kot.findUniqueOrThrow({ where: { id: kotId }, select: { printCount: true } });
    return { ok: true, printCount };
  });
}
