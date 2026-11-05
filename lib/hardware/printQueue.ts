import "server-only";
import { Prisma, type PrintJobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateForInput, formatNaira } from "@/lib/format";
import type { PurchaseDocument } from "@/app/(dashboard)/purchases/queries";
import { PAYMENT_STATUS_LABELS, PAYMENT_TYPE_LABELS } from "@/components/purchases/purchase-display";
import { resolvePrinter } from "./assignments";
import type { ReceiptTicket, TicketTemplate } from "./tickets";
import { wakePrintWorker } from "./printWorker";

// The print service: the one way anything prints. A job names its role
// (or a printer, for a test page), its template and the data to print —
// a snapshot, so a reprint prints the same ticket — and goes to the queue
// (PrintJob); the worker (printWorker.ts) prints it. A role with no printer
// isn't queued: { queued: false } — the caller falls back to the browser's
// print page (as before printers were set up).

export type EnqueueInput = {
  type: PrintJobType;
  // STATION:<id>, RECEIPT, PREBILL — or a printer by id (a test page).
  role?: string;
  printerId?: string;
  refId?: string | null;
  label: string;
  template: TicketTemplate;
  data: Prisma.InputJsonValue;
  createdById?: string | null;
  deviceId?: string | null;
  reprint?: boolean;
  reprintOfId?: string | null;
  // Auto-prints: one job per key, ever ("KOT:<kotId>").
  dedupeKey?: string | null;
  copies?: number;
};

export type Enqueued = { queued: true; jobId: string; printer: string } | { queued: false; reason: "NO_PRINTER" };

export async function enqueuePrint(input: EnqueueInput): Promise<Enqueued> {
  let printerId = input.printerId ?? null;
  let copies = input.copies ?? 1;
  if (!printerId && input.role) {
    const [assignments, overrides] = await Promise.all([
      prisma.printerAssignment.findMany({ where: { printer: { deletedAt: null } }, select: { role: true, printerId: true, fallbackPrinterId: true, copies: true } }),
      input.deviceId ? prisma.deviceOverride.findMany({ where: { deviceId: input.deviceId, printer: { deletedAt: null } }, select: { deviceId: true, role: true, printerId: true } }) : Promise.resolve([]),
    ]);
    const resolved = resolvePrinter(input.role, input.deviceId ?? null, assignments, overrides);
    if (resolved) {
      printerId = resolved.printerId;
      copies = input.copies ?? resolved.copies;
    }
  }
  if (!printerId) return { queued: false, reason: "NO_PRINTER" };
  const printer = await prisma.printer.findFirst({ where: { id: printerId, deletedAt: null }, select: { id: true, name: true } });
  if (!printer) return { queued: false, reason: "NO_PRINTER" };
  try {
    const job = await prisma.printJob.create({
      data: {
        printerId: printer.id,
        role: input.role ?? null,
        type: input.type,
        refId: input.refId ?? null,
        label: input.label.slice(0, 160),
        template: input.template,
        data: input.data,
        copies: Math.max(1, Math.min(5, copies)),
        reprint: input.reprint ?? false,
        reprintOfId: input.reprintOfId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        createdById: input.createdById ?? null,
        deviceId: input.deviceId ?? null,
      },
      select: { id: true },
    });
    wakePrintWorker();
    return { queued: true, jobId: job.id, printer: printer.name };
  } catch (error) {
    // Already queued under that key (a double click, a retried action): the same job.
    if (input.dedupeKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.printJob.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true, printer: { select: { name: true } } } });
      if (existing) return { queued: true, jobId: existing.id, printer: existing.printer.name };
    }
    throw error;
  }
}

// A sale's receipt as the ticket prints it — the same rows as the receipt
// page (components/pos/SaleReceipt.tsx), from the same document.
export function receiptTicket(
  sale: PurchaseDocument,
  extras: { details?: readonly (readonly [string, string])[]; shippingLabel?: string; afterPayments?: readonly (readonly [string, string])[] } = {},
): ReceiptTicket {
  const [year, month, day] = formatDateForInput(sale.date).split("-");
  return {
    title: "RingzPOS",
    place: sale.warehouse.name,
    reference: sale.reference,
    date: `${day}/${month}/${year}`,
    customer: sale.party.name,
    details: (extras.details ?? []).map(([a, b]) => [a, b]),
    items: sale.items.map((item) => ({ name: item.name, quantity: item.quantity, unitCost: formatNaira(item.unitCost), subtotal: formatNaira(item.subtotal) })),
    totals: [
      [`Order tax (${sale.orderTaxRate}%)`, formatNaira(sale.orderTaxAmount)],
      ["Discount", formatNaira(sale.discount)],
      [extras.shippingLabel ?? "Shipping", formatNaira(sale.shipping)],
    ],
    grandTotal: formatNaira(sale.grandTotal),
    payments: (sale.payments ?? []).map((pay) => [`Paid · ${PAYMENT_TYPE_LABELS[pay.paymentType]}`, formatNaira(pay.amount)]),
    due: formatNaira(sale.due ?? "0"),
    status: sale.paymentStatus ? PAYMENT_STATUS_LABELS[sale.paymentStatus] : null,
    afterPayments: (extras.afterPayments ?? []).map(([a, b]) => [a, b]),
    footer: "Thank you for your purchase.",
  };
}

// The printer a role prints on from this device — its name, or null (the
// screen then offers its browser print page instead).
export async function printerFor(role: string, deviceId: string | null): Promise<string | null> {
  const [assignments, overrides] = await Promise.all([
    prisma.printerAssignment.findMany({ where: { printer: { deletedAt: null } }, select: { role: true, printerId: true, fallbackPrinterId: true, copies: true } }),
    deviceId ? prisma.deviceOverride.findMany({ where: { deviceId, printer: { deletedAt: null } }, select: { deviceId: true, role: true, printerId: true } }) : Promise.resolve([]),
  ]);
  const resolved = resolvePrinter(role, deviceId, assignments, overrides);
  if (!resolved) return null;
  return (await prisma.printer.findUnique({ where: { id: resolved.printerId }, select: { name: true } }))?.name ?? null;
}

// Each kitchen station's printer name (station code → name), for the kitchen display.
export async function stationPrinters(): Promise<Record<string, string>> {
  const rows = await prisma.printerAssignment.findMany({
    where: { stationId: { not: null }, printer: { deletedAt: null } },
    select: { station: { select: { code: true } }, printer: { select: { name: true } } },
  });
  return Object.fromEntries(rows.filter((r) => r.station).map((r) => [r.station!.code, r.printer.name]));
}

// Waits for a job to finish (a test page, where the screen says how it
// went): DONE, FAILED, or still waiting after `timeoutMs`.
export async function waitForJob(jobId: string, timeoutMs = 15_000): Promise<{ status: string; error: string | null }> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const job = await prisma.printJob.findUnique({ where: { id: jobId }, select: { status: true, error: true } });
    if (!job) return { status: "GONE", error: "The job is gone." };
    if (job.status === "DONE" || job.status === "FAILED" || job.status === "CANCELLED" || Date.now() > end) return job;
    await new Promise((r) => setTimeout(r, 300));
  }
}
