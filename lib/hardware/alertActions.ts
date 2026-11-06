"use server";

import { prisma } from "@/lib/db";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import type { PrinterAlert } from "./alertText";
import { RECEIPT, stationRole } from "./assignments";
import { currentDeviceId } from "./device";
import { missingMessages } from "./reconnect";

// The printer badge (components/hardware/PrinterAlerts.tsx) on the kitchen
// display and the POS: the printers they print on that are offline or out of
// paper with jobs waiting, or that have jobs that failed in the last day.
//   kitchen   the stations' printers (and their fallbacks)
//   till      the receipt and pre-bill printers (this device's own, if set)
// Admins (Manage Setting) are also told a role has no printer — "No printer
// assigned for Bar. Set up." (Step 7) — once any printer is set up; everyone
// else just gets the browser's print page there, as before. Signed-in users
// only. Never throws.

const FAILED_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function printerAlerts(scope: "kitchen" | "till"): Promise<{ ok: true; alerts: PrinterAlert[]; canManage: boolean; missing: string[] } | { ok: false }> {
  try {
    const current = await getCurrentUserPermissions();
    if (!current.userId) return { ok: false };
    const canManage = current.permissions.has(PERMISSIONS.MANAGE_SETTING);
    let missing: string[] = [];
    if (canManage) {
      const [printerCount, roles] = await Promise.all([
        prisma.printer.count({ where: { deletedAt: null } }),
        scope === "kitchen"
          ? prisma.kitchenStation.findMany({ where: { deletedAt: null, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }).then((rows) => rows.map((s) => ({ role: stationRole(s.id), label: s.name })))
          : Promise.resolve([{ role: RECEIPT, label: "Receipt" }]),
      ]);
      const assigned = new Set((await prisma.printerAssignment.findMany({ where: { printer: { deletedAt: null } }, select: { role: true } })).map((a) => a.role));
      missing = missingMessages(roles, assigned, printerCount > 0);
    }
    const assignments = await prisma.printerAssignment.findMany({
      where: scope === "kitchen" ? { role: { startsWith: "STATION:" } } : { role: { in: ["RECEIPT", "PREBILL"] } },
      select: { printerId: true, fallbackPrinterId: true },
    });
    const ids = new Set(assignments.flatMap((a) => [a.printerId, a.fallbackPrinterId].filter((x): x is string => !!x)));
    if (scope === "till") {
      const deviceId = await currentDeviceId();
      if (deviceId) (await prisma.deviceOverride.findMany({ where: { deviceId }, select: { printerId: true } })).forEach((o) => ids.add(o.printerId));
    }
    if (ids.size === 0) return { ok: true, alerts: [], canManage, missing };
    const [printers, waiting, failed] = await Promise.all([
      prisma.printer.findMany({ where: { id: { in: [...ids] }, deletedAt: null }, select: { id: true, name: true, lastStatus: true } }),
      prisma.printJob.groupBy({ by: ["printerId"], where: { printerId: { in: [...ids] }, status: { in: ["QUEUED", "PRINTING"] } }, _count: { _all: true } }),
      // A drawer kick that failed isn't a ticket to sort out (Open drawer again).
      prisma.printJob.groupBy({ by: ["printerId"], where: { printerId: { in: [...ids] }, type: { not: "DRAWER" }, status: "FAILED", updatedAt: { gte: new Date(Date.now() - FAILED_WINDOW_MS) } }, _count: { _all: true } }),
    ]);
    const count = (rows: { printerId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.printerId === id)?._count._all ?? 0;
    const alerts = printers
      .map((p) => ({ printer: p.name, status: p.lastStatus, waiting: count(waiting, p.id), failed: count(failed, p.id) }))
      .filter((a) => a.failed > 0 || (a.waiting > 0 && (a.status === "OFFLINE" || a.status === "PAPER_OUT")))
      .sort((a, b) => a.printer.localeCompare(b.printer));
    return { ok: true, alerts, canManage, missing };
  } catch (error) {
    console.error("[print] alerts failed:", error);
    return { ok: false };
  }
}
