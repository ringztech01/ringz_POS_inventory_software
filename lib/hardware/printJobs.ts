import "server-only";
import type { PrintJobStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// The print queue screen's data: jobs newest first, by printer and status.

export const PRINT_JOB_STATUSES: PrintJobStatus[] = ["QUEUED", "PRINTING", "DONE", "FAILED", "CANCELLED"];
export const JOBS_PER_PAGE = 50;

export type PrintJobRow = {
  id: string;
  createdAt: string;
  printedAt: string | null;
  type: string;
  label: string;
  printer: string;
  reroutedFrom: string | null;
  status: PrintJobStatus;
  attempts: number;
  error: string | null;
  reprint: boolean;
  copies: number;
  by: string | null;
};

export function readJobFilter(params: { printer?: string; status?: string; page?: string }, printerIds: readonly string[]) {
  return {
    printerId: params.printer && printerIds.includes(params.printer) ? params.printer : null,
    status: PRINT_JOB_STATUSES.find((s) => s === params.status) ?? null,
    page: Math.max(1, Math.floor(Number(params.page)) || 1),
  };
}

export async function getPrintJobs(filter: { printerId: string | null; status: PrintJobStatus | null; page: number }): Promise<{ rows: PrintJobRow[]; total: number; counts: Record<string, number> }> {
  const where: Prisma.PrintJobWhereInput = { ...(filter.printerId ? { printerId: filter.printerId } : {}), ...(filter.status ? { status: filter.status } : {}) };
  const [jobs, total, grouped] = await Promise.all([
    prisma.printJob.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filter.page - 1) * JOBS_PER_PAGE,
      take: JOBS_PER_PAGE,
      include: { printer: { select: { name: true } }, reroutedFrom: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
    }),
    prisma.printJob.count({ where }),
    prisma.printJob.groupBy({ by: ["status"], where: filter.printerId ? { printerId: filter.printerId } : {}, _count: { _all: true } }),
  ]);
  return {
    total,
    counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
    rows: jobs.map((j) => ({
      id: j.id,
      createdAt: j.createdAt.toISOString(),
      printedAt: j.printedAt?.toISOString() ?? null,
      type: j.type,
      label: j.label,
      printer: j.printer.name,
      reroutedFrom: j.reroutedFrom?.name ?? null,
      status: j.status,
      attempts: j.attempts,
      error: j.error,
      reprint: j.reprint,
      copies: j.copies,
      by: j.createdBy ? `${j.createdBy.firstName} ${j.createdBy.lastName}`.trim() : null,
    })),
  };
}

export async function getQueuePrinters(): Promise<{ id: string; name: string }[]> {
  return prisma.printer.findMany({ where: { OR: [{ deletedAt: null }, { printJobs: { some: {} } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
