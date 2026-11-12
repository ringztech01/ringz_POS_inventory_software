import "server-only";
import type { PaymentType, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { RECEIPT } from "@/lib/hardware/assignments";
import { deviceLabel } from "@/lib/hardware/deviceLabel";
import { enqueuePrint, printerFor } from "@/lib/hardware/printQueue";
import { expectedCash, METHOD_LABEL, METHODS, variance, varianceLabel } from "../../lib/cashUp";
import { zReport, type TillFigures, type TillSummary } from "../../lib/zReport";

export type { TillFigures, TillSummary } from "../../lib/zReport";
import { defaultDisplayName } from "../../lib/staffPins";

// Cash-up per till (Part 6f Step 7b). A till is a device (its own cash
// drawer, if it has one): someone with Settle Bill opens it with a float;
// payments, cash tips and cash refunds taken on it while it's open point to
// its session (settle, refunds and the counter POS ask tillSessionIdFor);
// at the close the cash is counted and the figures are kept as they were.
// One open session per device. Every open, close and Z-report print is
// logged.

type Db = Prisma.TransactionClient | typeof prisma;
const nameOf = (u: { firstName: string; lastName: string; displayName: string | null }) => u.displayName || defaultDisplayName(u.firstName, u.lastName);
const PERSON = { select: { firstName: true, lastName: true, displayName: true } } as const;

const openOf = (db: Db, deviceId: string) => db.tillSession.findFirst({ where: { deviceId, closedAt: null }, orderBy: { openedAt: "desc" }, select: { id: true } });

// The open session on this device, for a payment taken now — or null (no
// device, none open). Never stops the payment: a failed look-up is null.
export async function tillSessionIdFor(deviceId: string | null, db: Db = prisma): Promise<string | null> {
  if (!deviceId) return null;
  try {
    return (await openOf(db, deviceId))?.id ?? null;
  } catch (error) {
    console.warn("[till] couldn't find the open till:", error);
    return null;
  }
}

// What a session took and paid out, now.
export async function tillFigures(db: Db, session: { id: string; deviceId: string; float: Decimal.Value; openedAt: Date; closedAt: Date | null }): Promise<TillFigures> {
  const [payments, tips, refunds, drawerByHand] = await Promise.all([
    db.salePayment.groupBy({ by: ["paymentType"], where: { tillSessionId: session.id, deletedAt: null }, _sum: { amount: true }, _count: { _all: true } }),
    db.orderTip.groupBy({ by: ["paymentType"], where: { tillSessionId: session.id, deletedAt: null }, _sum: { amount: true } }),
    db.saleReturnPayment.groupBy({ by: ["paymentType"], where: { tillSessionId: session.id, deletedAt: null }, _sum: { amount: true }, _count: { _all: true } }),
    db.drawerEvent.count({ where: { deviceId: session.deviceId, reason: "MANUAL", createdAt: { gte: session.openedAt, ...(session.closedAt ? { lte: session.closedAt } : {}) } } }),
  ]);
  const sum = (rows: { paymentType: PaymentType; _sum: { amount: Prisma.Decimal | null } }[], method: PaymentType) => new Decimal(rows.find((r) => r.paymentType === method)?._sum.amount?.toString() ?? "0");
  const cashSales = sum(payments, "CASH");
  const cashTips = sum(tips, "CASH");
  const cashRefunds = sum(refunds, "CASH");
  const expected = expectedCash({ float: session.float, cashSales, cashTips, cashRefunds });
  return {
    float: new Decimal(session.float).toFixed(2),
    cashSales: cashSales.toFixed(2),
    cashTips: cashTips.toFixed(2),
    cashRefunds: cashRefunds.toFixed(2),
    expected: expected.toFixed(2),
    byMethod: METHODS.map((method) => ({ method, label: METHOD_LABEL[method], amount: sum(payments, method).toFixed(2), count: payments.find((r) => r.paymentType === method)?._count._all ?? 0 })),
    tipsByMethod: METHODS.map((method) => ({ method, label: METHOD_LABEL[method], amount: sum(tips, method).toFixed(2) })),
    refunds: { count: refunds.reduce((n, r) => n + r._count._all, 0), amount: refunds.reduce((d, r) => d.plus(r._sum.amount?.toString() ?? "0"), new Decimal(0)).toFixed(2) },
    drawerByHand,
  };
}

export type TillScreen = { deviceId: string; till: string; open: TillSummary | null; recent: TillSummary[]; printer: string | null };

const SESSION = {
  id: true,
  deviceId: true,
  float: true,
  openedAt: true,
  closedAt: true,
  counted: true,
  variance: true,
  note: true,
  zPrintedAt: true,
  cashSales: true,
  cashTips: true,
  cashRefunds: true,
  expected: true,
  openedBy: PERSON,
  closedBy: PERSON,
} as const;
type SessionRow = Prisma.TillSessionGetPayload<{ select: typeof SESSION }>;

async function summarise(db: Db, row: SessionRow): Promise<TillSummary> {
  const figures = await tillFigures(db, row);
  // A closed one keeps the cash figures it closed with.
  if (row.closedAt && row.expected) {
    figures.cashSales = row.cashSales?.toFixed(2) ?? figures.cashSales;
    figures.cashTips = row.cashTips?.toFixed(2) ?? figures.cashTips;
    figures.cashRefunds = row.cashRefunds?.toFixed(2) ?? figures.cashRefunds;
    figures.expected = row.expected.toFixed(2);
  }
  return {
    id: row.id,
    openedBy: nameOf(row.openedBy),
    openedAt: row.openedAt.toISOString(),
    closedBy: row.closedBy ? nameOf(row.closedBy) : null,
    closedAt: row.closedAt?.toISOString() ?? null,
    figures,
    counted: row.counted?.toFixed(2) ?? null,
    variance: row.variance?.toFixed(2) ?? null,
    result: row.variance ? varianceLabel(row.variance.toString()) : null,
    note: row.note,
    zPrinted: !!row.zPrintedAt,
  };
}

export async function getTillScreen(deviceId: string): Promise<TillScreen> {
  const [device, open, recent, printer] = await Promise.all([
    prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true, userAgent: true } }),
    prisma.tillSession.findFirst({ where: { deviceId, closedAt: null }, orderBy: { openedAt: "desc" }, select: SESSION }),
    prisma.tillSession.findMany({ where: { deviceId, closedAt: { not: null } }, orderBy: { closedAt: "desc" }, take: 5, select: SESSION }),
    printerFor(RECEIPT, deviceId).catch(() => null),
  ]);
  return {
    deviceId,
    till: deviceLabel(device) ?? "This device",
    open: open ? await summarise(prisma, open) : null,
    recent: await Promise.all(recent.map((r) => summarise(prisma, r))),
    printer,
  };
}

type Done<T> = ({ ok: true } & T) | { ok: false; error: string };

// Open the till with a float. Under a lock on the device's row, so two
// screens can't open it twice.
export async function openTill(input: { deviceId: string; float: Decimal }, userId: string): Promise<Done<{ id: string }>> {
  return prisma.$transaction(async (tx): Promise<Done<{ id: string }>> => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM \`Device\` WHERE id = ${input.deviceId} FOR UPDATE`;
    if (!rows.length) return { ok: false, error: "This device isn't known yet. Reload the page and try again." };
    if (await openOf(tx, input.deviceId)) return { ok: false, error: "This till is open already — refreshed." };
    const session = await tx.tillSession.create({ data: { deviceId: input.deviceId, openedById: userId, float: input.float.toFixed(2) }, select: { id: true } });
    await writeAudit({ userId, action: "till.open", entityType: "TillSession", entityId: session.id, meta: { deviceId: input.deviceId, float: input.float.toFixed(2) } }, tx);
    return { ok: true, id: session.id };
  });
}

// Close it with the cash counted: the figures are worked out and kept, the
// variance with them. Only the open one, once.
export async function closeTill(input: { deviceId: string; sessionId: string; counted: Decimal; note: string | null }, userId: string): Promise<Done<{ summary: TillSummary }>> {
  return prisma.$transaction(
    async (tx): Promise<Done<{ summary: TillSummary }>> => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM \`TillSession\` WHERE id = ${input.sessionId} AND deviceId = ${input.deviceId} AND closedAt IS NULL FOR UPDATE`;
      if (!rows.length) return { ok: false, error: "This till has been closed already — refreshed." };
      const session = await tx.tillSession.findUniqueOrThrow({ where: { id: input.sessionId }, select: { id: true, deviceId: true, float: true, openedAt: true } });
      const now = new Date();
      const figures = await tillFigures(tx, { ...session, float: session.float.toString(), closedAt: now });
      const v = variance(input.counted, figures.expected);
      await tx.tillSession.update({
        where: { id: session.id },
        data: {
          closedAt: now,
          closedById: userId,
          cashSales: figures.cashSales,
          cashTips: figures.cashTips,
          cashRefunds: figures.cashRefunds,
          expected: figures.expected,
          counted: input.counted.toFixed(2),
          variance: v.toFixed(2),
          note: input.note,
        },
      });
      await writeAudit(
        { userId, action: "till.close", entityType: "TillSession", entityId: session.id, meta: { deviceId: input.deviceId, expected: figures.expected, counted: input.counted.toFixed(2), variance: v.toFixed(2) } },
        tx,
      );
      const row = await tx.tillSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION });
      return { ok: true, summary: await summarise(tx, row) };
    },
    { timeout: 20_000 },
  );
}

// Print a closed session's Z-report on this till's receipt printer (the
// print queue, Part 6d). Logged; a reprint says so.
export async function printZReport(input: { deviceId: string; sessionId: string }, userId: string): Promise<Done<{ printer: string; reprint: boolean }>> {
  const row = await prisma.tillSession.findFirst({ where: { id: input.sessionId, deviceId: input.deviceId, closedAt: { not: null } }, select: SESSION });
  if (!row) return { ok: false, error: "That cash-up isn't on this till." };
  const device = await prisma.device.findUnique({ where: { id: input.deviceId }, select: { id: true, name: true, userAgent: true } });
  const summary = await summarise(prisma, row);
  const queued = await enqueuePrint({
    role: RECEIPT,
    deviceId: input.deviceId,
    type: "REPORT",
    template: "ZREPORT",
    label: `Z-report · ${deviceLabel(device) ?? "till"}`,
    refId: row.id,
    data: zReport(deviceLabel(device) ?? "This till", summary) as unknown as Prisma.InputJsonValue,
    createdById: userId,
    reprint: !!row.zPrintedAt,
  });
  if (!queued.queued) return { ok: false, error: "This till has no receipt printer. Set one up in Settings › Printers." };
  await prisma.tillSession.update({ where: { id: row.id }, data: { zPrintedAt: new Date() } });
  await writeAudit({ userId, action: "till.z.print", entityType: "TillSession", entityId: row.id, meta: { printer: queued.printer, reprint: !!row.zPrintedAt } });
  return { ok: true, printer: queued.printer, reprint: !!row.zPrintedAt };
}
