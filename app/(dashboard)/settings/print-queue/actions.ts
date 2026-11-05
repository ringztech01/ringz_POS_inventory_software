"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { currentDeviceId } from "@/lib/hardware/device";
import { enqueuePrint } from "@/lib/hardware/printQueue";
import { wakePrintWorker } from "@/lib/hardware/printWorker";
import type { TicketTemplate } from "@/lib/hardware/tickets";

// The print queue screen: Retry (a failed or cancelled job goes back in
// line), Reprint (any finished job, again — marked REPRINT), Cancel (a job
// still waiting). Manage Setting. Never throws. A cash drawer kick is never
// sent again from here: Open drawer (its permission, a reason, the log).

type Result = { ok: true; message: string } | { ok: false; error: string };
const GONE = "That job is no longer there — refreshed.";
const NOT_A_PRINT = "A cash drawer kick isn't sent again from here — use Open drawer at the till.";

async function guarded(label: string, body: (userId: string) => Promise<Result>): Promise<Result> {
  try {
    const auth = await requirePermission(PERMISSIONS.MANAGE_SETTING);
    if (auth.error !== undefined) return { ok: false, error: auth.error };
    const result = await body(auth.userId);
    if (result.ok) revalidatePath("/settings/print-queue");
    return result;
  } catch (error) {
    console.error(`[print] ${label} failed:`, error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function retryJob(id: unknown): Promise<Result> {
  return guarded("retry", async () => {
    if (typeof id !== "string") return { ok: false, error: GONE };
    const job = await prisma.printJob.findUnique({ where: { id }, select: { status: true, type: true, printer: { select: { deletedAt: true } } } });
    if (!job) return { ok: false, error: GONE };
    if (job.type === "DRAWER") return { ok: false, error: NOT_A_PRINT };
    if (job.printer.deletedAt) return { ok: false, error: "Its printer was removed — reprint it instead (it goes to the role's printer now)." };
    const moved = await prisma.printJob.updateMany({ where: { id, type: { not: "DRAWER" }, status: { in: ["FAILED", "CANCELLED"] } }, data: { status: "QUEUED", attempts: 0, error: null, nextAttemptAt: new Date() } });
    if (moved.count === 0) return { ok: false, error: "Only failed or cancelled jobs can be retried — refreshed." };
    wakePrintWorker();
    return { ok: true, message: "Back in the queue." };
  });
}

export async function cancelJob(id: unknown): Promise<Result> {
  return guarded("cancel", async () => {
    if (typeof id !== "string") return { ok: false, error: GONE };
    const moved = await prisma.printJob.updateMany({ where: { id, status: "QUEUED" }, data: { status: "CANCELLED", error: "Cancelled by hand." } });
    return moved.count ? { ok: true, message: "Job cancelled." } : { ok: false, error: "Only a job still waiting can be cancelled — refreshed." };
  });
}

// Again, as it was queued (its data snapshot), marked REPRINT — on the
// role's printer now (or its own printer, for a test page / no role).
export async function reprintJob(id: unknown): Promise<Result> {
  return guarded("reprint", async (userId) => {
    if (typeof id !== "string") return { ok: false, error: GONE };
    const job = await prisma.printJob.findUnique({ where: { id } });
    if (!job) return { ok: false, error: GONE };
    if (job.type === "DRAWER") return { ok: false, error: NOT_A_PRINT };
    if (job.status === "QUEUED" || job.status === "PRINTING") return { ok: false, error: "It's still in the queue — wait for it, or cancel it." };
    const queued = await enqueuePrint({
      type: job.type,
      role: job.role ?? undefined,
      printerId: job.role ? undefined : job.printerId,
      refId: job.refId,
      label: job.label,
      template: job.template as TicketTemplate,
      data: job.data as Prisma.InputJsonValue,
      createdById: userId,
      deviceId: await currentDeviceId(),
      reprint: true,
      reprintOfId: job.id,
      copies: 1,
    });
    return queued.queued ? { ok: true, message: `Reprint sent to ${queued.printer}.` } : { ok: false, error: "No printer is assigned for that job any more — set one in Printers." };
  });
}
