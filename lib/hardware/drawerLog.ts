import "server-only";
import type { DrawerReason, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// The drawer log's data (Settings › Printers › Drawer log): every time the
// cash drawer was told to open, newest first, by reason.

export const DRAWER_REASONS: DrawerReason[] = ["CASH_SALE", "CASH_REFUND", "MANUAL", "TEST"];
export const EVENTS_PER_PAGE = 50;

export type DrawerEventRow = {
  id: string;
  createdAt: string;
  reason: DrawerReason;
  note: string | null;
  ref: string | null;
  printer: string;
  device: string | null;
  by: string | null;
  // The kick's print job: DONE (opened), CANCELLED / FAILED (not), or still going.
  status: string;
  error: string | null;
};

export function readDrawerFilter(params: { reason?: string; page?: string }) {
  return {
    reason: DRAWER_REASONS.find((r) => r === params.reason) ?? null,
    page: Math.max(1, Math.floor(Number(params.page)) || 1),
  };
}

export async function getDrawerEvents(filter: { reason: DrawerReason | null; page: number }): Promise<{ rows: DrawerEventRow[]; total: number; counts: Record<string, number> }> {
  const where: Prisma.DrawerEventWhereInput = filter.reason ? { reason: filter.reason } : {};
  const [events, total, grouped] = await Promise.all([
    prisma.drawerEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filter.page - 1) * EVENTS_PER_PAGE,
      take: EVENTS_PER_PAGE,
      include: {
        printer: { select: { name: true } },
        printJob: { select: { status: true, error: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.drawerEvent.count({ where }),
    prisma.drawerEvent.groupBy({ by: ["reason"], _count: { _all: true } }),
  ]);
  const deviceIds = [...new Set(events.map((e) => e.deviceId).filter((id): id is string => !!id))];
  const devices = deviceIds.length ? await prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } }) : [];
  return {
    total,
    counts: Object.fromEntries(grouped.map((g) => [g.reason, g._count._all])),
    rows: events.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      reason: e.reason,
      note: e.note,
      ref: e.refLabel,
      printer: e.printer.name,
      device: e.deviceId ? (devices.find((d) => d.id === e.deviceId)?.name ?? "Unnamed device") : null,
      by: e.user ? `${e.user.firstName} ${e.user.lastName}`.trim() : null,
      status: e.printJob.status,
      error: e.printJob.error,
    })),
  };
}
