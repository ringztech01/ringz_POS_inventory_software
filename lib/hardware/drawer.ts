import "server-only";
import { Prisma, type DrawerReason } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RECEIPT, resolvePrinter } from "./assignments";
import { DRAWER_REASON_LABEL } from "./drawerKick";
import { wakePrintWorker } from "./printWorker";

// The cash drawer service: the one way the drawer opens. Each open is a
// DRAWER job on the queue (the worker sends the kick — drawerKick.ts) and a
// DrawerEvent (why, who, which till, which sale) written together in one
// transaction. Auto-opens carry a dedupeKey, so a retried settle opens it
// once.
//
// Which drawer: the one on the printer this device prints receipts on (its
// own override, else the Receipt role's printer) — when that printer has
// "Cash drawer" on. Never the fallback printer: that's another till's drawer.

export type DrawerPrinter = { id: string; name: string };

export async function drawerPrinterFor(deviceId: string | null): Promise<DrawerPrinter | null> {
  const [assignments, overrides] = await Promise.all([
    prisma.printerAssignment.findMany({ where: { role: RECEIPT, printer: { deletedAt: null } }, select: { role: true, printerId: true, fallbackPrinterId: true, copies: true } }),
    deviceId ? prisma.deviceOverride.findMany({ where: { deviceId, role: RECEIPT, printer: { deletedAt: null } }, select: { deviceId: true, role: true, printerId: true } }) : Promise.resolve([]),
  ]);
  const resolved = resolvePrinter(RECEIPT, deviceId, assignments, overrides);
  if (!resolved) return null;
  return prisma.printer.findFirst({ where: { id: resolved.printerId, deletedAt: null, openDrawer: true }, select: { id: true, name: true } });
}

export type OpenDrawerInput = {
  reason: DrawerReason;
  userId: string | null;
  deviceId: string | null;
  // A printer by id (the Settings test); otherwise this device's drawer.
  printerId?: string;
  note?: string | null;
  // The Sale / SaleReturn and its reference.
  refId?: string | null;
  refLabel?: string | null;
  // Auto-opens: one per key, ever ("DRAWER:SETTLE:<idempotencyKey>").
  dedupeKey?: string | null;
};

export type DrawerOpened = { sent: true; jobId: string; printer: string; again: boolean } | { sent: false; reason: "NO_DRAWER" };

export async function openDrawer(input: OpenDrawerInput): Promise<DrawerOpened> {
  const printer = input.printerId
    ? await prisma.printer.findFirst({ where: { id: input.printerId, deletedAt: null, openDrawer: true }, select: { id: true, name: true } })
    : await drawerPrinterFor(input.deviceId);
  if (!printer) return { sent: false, reason: "NO_DRAWER" };
  const label = [`Cash drawer · ${DRAWER_REASON_LABEL[input.reason]}`, input.refLabel].filter(Boolean).join(" · ");
  try {
    const jobId = await prisma.$transaction(async (tx) => {
      const job = await tx.printJob.create({
        data: {
          printerId: printer.id,
          type: "DRAWER",
          template: "DRAWER",
          data: { reason: input.reason },
          refId: input.refId ?? null,
          label: label.slice(0, 160),
          dedupeKey: input.dedupeKey ?? null,
          createdById: input.userId,
          deviceId: input.deviceId,
        },
        select: { id: true },
      });
      await tx.drawerEvent.create({
        data: {
          reason: input.reason,
          note: input.note?.slice(0, 140) || null,
          printerId: printer.id,
          printJobId: job.id,
          refId: input.refId ?? null,
          refLabel: input.refLabel?.slice(0, 80) ?? null,
          userId: input.userId,
          deviceId: input.deviceId,
        },
      });
      return job.id;
    });
    wakePrintWorker();
    return { sent: true, jobId, printer: printer.name, again: false };
  } catch (error) {
    // Opened under that key already (a retried settle): not again.
    if (input.dedupeKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.printJob.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true, printer: { select: { name: true } } } });
      if (existing) return { sent: true, jobId: existing.id, printer: existing.printer.name, again: true };
    }
    throw error;
  }
}

// For a sale or refund that's already saved: opens the drawer if this till
// has one, and never fails the sale — a problem is logged, and the cashier
// still has Open drawer. Answers the drawer's printer (null: none / failed).
export async function openDrawerForCash(input: OpenDrawerInput): Promise<string | null> {
  try {
    const opened = await openDrawer(input);
    return opened.sent ? opened.printer : null;
  } catch (error) {
    console.error("[drawer] couldn't open the cash drawer:", error);
    return null;
  }
}
