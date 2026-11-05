import "server-only";
import { Prisma } from "@prisma/client";
import { COMPANY } from "@/lib/company";
import { formatNaira } from "@/lib/format";
import { getSaleDocument } from "@/app/(dashboard)/sales/queries";
import { PREBILL, RECEIPT, stationRole } from "@/lib/hardware/assignments";
import { enqueuePrint, receiptTicket, type Enqueued } from "@/lib/hardware/printQueue";
import type { KotTicket, PrebillTicket } from "@/lib/hardware/tickets";
import { prisma } from "@/lib/db";
import { getBill } from "../queries/bill";
import { getKotForPrint } from "../queries/kds";
import { getReceiptExtras } from "../queries/receipt";

// The restaurant's tickets on the print queue (lib/hardware/printQueue.ts):
//   KOT       each station's ticket, to that station's printer (its copies)
//             — on Send to kitchen, a Remake, and a VOID on a cancel; Print
//             KOT on the kitchen display is a reprint
//   PREBILL   the guest's bill (NOT A RECEIPT) — the pre-bill printer, or
//             the receipt printer when none is set
//   RECEIPT   a settled bill's receipt — on settle, and again on request
// A role with no printer: { queued: false } and the screen opens its print
// page as before. Never fails the action that asked: a print problem is
// logged and shows on the queue.

type Who = { userId: string; deviceId: string | null };

export async function kotTicket(kotId: string): Promise<{ ticket: KotTicket; stationId: string; label: string; printCount: number } | null> {
  const kot = await getKotForPrint(kotId);
  if (!kot) return null;
  const { stationId, printCount, lines } = await prisma.kot.findUniqueOrThrow({
    where: { id: kotId },
    select: { stationId: true, printCount: true, lines: { orderBy: { id: "asc" }, select: { quantity: true, orderItem: { select: { unitPrice: true } } } } },
  });
  // Each line's price, for KOTs set to show prices (in the ticket's line order).
  const amounts = lines.map((l) => formatNaira(new Prisma.Decimal(l.orderItem.unitPrice).times(l.quantity).toFixed(2)));
  return {
    stationId,
    printCount,
    label: `${kot.ref}${kot.type === "VOID" ? " VOID" : ""} · ${kot.station} · ${kot.table}`,
    ticket: {
      ref: kot.ref,
      type: kot.type,
      note: kot.note,
      station: kot.station,
      table: kot.table,
      orderRef: kot.orderRef,
      orderType: kot.orderType,
      area: kot.area,
      guests: kot.guests,
      waiter: kot.waiter,
      createdAt: kot.createdAt.toISOString(),
      lines: kot.lines.map((line, i) => ({ ...line, amount: amounts[i] })),
      items: kot.items,
    },
  };
}

// New tickets, each once ("KOT:<id>").
export async function printNewKots(kotIds: readonly string[], who: Who): Promise<void> {
  for (const kotId of kotIds) {
    try {
      const kot = await kotTicket(kotId);
      if (!kot) continue;
      await enqueuePrint({
        type: kot.ticket.type === "VOID" ? "KOT_VOID" : "KOT",
        role: stationRole(kot.stationId),
        refId: kotId,
        label: kot.label,
        template: "KOT",
        data: kot.ticket,
        createdById: who.userId,
        deviceId: who.deviceId,
        dedupeKey: `KOT:${kotId}`,
      });
    } catch (error) {
      console.error(`[print] couldn't queue KOT ${kotId}:`, error);
    }
  }
}

// Print KOT on the kitchen display: a reprint once it has printed.
export async function reprintKot(kotId: string, who: Who): Promise<Enqueued | null> {
  const kot = await kotTicket(kotId);
  if (!kot) return null;
  const printedBefore = kot.printCount > 0 || (await prisma.printJob.count({ where: { refId: kotId, type: { in: ["KOT", "KOT_VOID"] }, status: { in: ["DONE", "QUEUED", "PRINTING"] } } })) > 0;
  return enqueuePrint({
    type: kot.ticket.type === "VOID" ? "KOT_VOID" : "KOT",
    role: stationRole(kot.stationId),
    refId: kotId,
    label: kot.label,
    template: "KOT",
    data: kot.ticket,
    createdById: who.userId,
    deviceId: who.deviceId,
    reprint: printedBefore,
  });
}

export async function prebillTicket(orderId: string): Promise<{ ticket: PrebillTicket; label: string } | null> {
  const bill = await getBill(orderId);
  if (!bill) return null;
  const { order, lines, totals } = bill;
  const rows: [string, string][] = [["Sub total", totals.subTotal]];
  if (bill.discount) rows.push([`Discount (${bill.discount.label})`, `-${totals.discount}`]);
  if (order.serviceCharge) rows.push([`Service charge (${totals.servicePercent})`, totals.serviceCharge]);
  rows.push([totals.taxLabel, totals.tax]);
  return {
    label: `Pre-bill ${order.ref} · ${order.table}`,
    ticket: {
      company: { name: COMPANY.name, address: COMPANY.address, phone: COMPANY.phone },
      table: order.table,
      ref: order.ref,
      orderType: order.type,
      waiter: order.waiter,
      guests: order.guests,
      printedAt: new Date().toISOString(),
      lines: lines.map((l) => ({ quantity: l.quantity, name: l.name, amount: l.amount, modifiers: l.modifiers, note: l.note })),
      totals: rows,
      total: totals.total,
      split: bill.split
        ? {
            title: `${bill.split.modeLabel} · ${bill.split.parts.length} parts`,
            parts: bill.split.parts.map((part) => ({ label: part.label, amount: part.amount, items: part.items.map((i) => `${i.quantity}x ${i.name}`).join(", ") })),
          }
        : null,
    },
  };
}

export async function printPrebill(orderId: string, who: Who): Promise<Enqueued | null> {
  const bill = await prebillTicket(orderId);
  if (!bill) return null;
  return enqueuePrint({ type: "PREBILL", role: PREBILL, refId: orderId, label: bill.label, template: "PREBILL", data: bill.ticket, createdById: who.userId, deviceId: who.deviceId });
}

// A settled bill's receipt: on settle (once — "RECEIPT:<saleId>"), or again.
export async function printRestaurantReceipt(saleId: string, who: Who, again: boolean): Promise<Enqueued | null> {
  const [sale, extras] = await Promise.all([getSaleDocument(saleId), getReceiptExtras(saleId)]);
  if (!sale || !extras) return null;
  return enqueuePrint({
    type: "RECEIPT",
    role: RECEIPT,
    refId: saleId,
    label: `Receipt ${sale.reference}`,
    template: "RECEIPT",
    data: receiptTicket(sale, { details: extras.details, shippingLabel: "Service charge", afterPayments: extras.tips }),
    createdById: who.userId,
    deviceId: who.deviceId,
    reprint: again,
    dedupeKey: again ? null : `RECEIPT:${saleId}`,
  });
}
