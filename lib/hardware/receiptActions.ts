"use server";

import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { getSaleDocument } from "@/app/(dashboard)/sales/queries";
import type { QueueAnswer } from "@/components/hardware/PrintButton";
import { RECEIPT } from "./assignments";
import { currentDeviceId } from "./device";
import { enqueuePrint, receiptTicket } from "./printQueue";

// The POS receipt's Print button when the Receipt role has a printer (this
// device's own, if it has one): the till receipt — the same rows as
// /pos/receipt/[id] — on the print queue. Manage Pos Screen, like the page.
export async function printPosReceipt(saleId: unknown): Promise<QueueAnswer> {
  try {
    const auth = await requirePermission(PERMISSIONS.MANAGE_POS_SCREEN);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    if (typeof saleId !== "string" || !saleId) return { ok: false, error: "That sale no longer exists." };
    const sale = await getSaleDocument(saleId);
    if (!sale) return { ok: false, error: "That sale no longer exists." };
    // Printed (or on its way) already: this copy says REPRINT.
    const printedBefore = (await prisma.printJob.count({ where: { type: "RECEIPT", refId: sale.id, status: { in: ["DONE", "QUEUED", "PRINTING"] } } })) > 0;
    const queued = await enqueuePrint({
      type: "RECEIPT",
      role: RECEIPT,
      refId: sale.id,
      label: `Receipt ${sale.reference}`,
      template: "RECEIPT",
      data: receiptTicket(sale),
      createdById: auth.userId,
      deviceId: await currentDeviceId(),
      reprint: printedBefore,
    });
    return { ok: true, printer: queued.queued ? queued.printer : null };
  } catch (error) {
    console.error("[print] POS receipt failed:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
