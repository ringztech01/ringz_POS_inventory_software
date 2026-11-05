"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { DEVICE_ROLES, REPORTS } from "@/lib/hardware/assignments";
import { discoverPrinters, printerStatuses, probePrinter, type PrinterStatusOf } from "@/lib/hardware/bridge";
import { currentDeviceId } from "@/lib/hardware/device";
import { openDrawer } from "@/lib/hardware/drawer";
import { enqueuePrint, waitForJob } from "@/lib/hardware/printQueue";
import { printerRoles } from "@/lib/hardware/printerSetup";
import { assignmentsSchema, deviceSchema, printerSchema, type PrinterField } from "@/lib/validations/printer";
import type { DiscoveredPrinter, DiscoveryResult } from "@/desktop/bridge/types.ts";

// Settings › Printers. Everything needs Manage Setting; inputs are parsed
// with zod and writes run in one transaction. Nothing here throws to the
// browser: failures come back as { ok: false, error }.

type Fail<F extends string = string> = { ok: false; error: string; fieldErrors?: Partial<Record<F, string[]>> };
const UNEXPECTED: Fail = { ok: false, error: "Something went wrong. Please try again." };
const refresh = () => revalidatePath("/settings/printers");

async function guarded<T>(label: string, body: () => Promise<T | Fail>): Promise<T | Fail> {
  try {
    const check = await requirePermission(PERMISSIONS.MANAGE_SETTING);
    if (check.error !== undefined) return { ok: false, error: check.error };
    return await body();
  } catch (error) {
    console.error(`[printers] ${label} failed:`, error);
    return UNEXPECTED;
  }
}

const live = { deletedAt: null } as const;

// ---- Discovery (the hardware bridge) -----------------------------------------

export async function discoverAction(network: unknown): Promise<({ ok: true } & DiscoveryResult) | Fail> {
  return guarded("discover", async () => {
    const result = await discoverPrinters({ network: network !== false });
    return result.ok ? { ok: true as const, ...result.data } : { ok: false as const, error: result.error };
  });
}

export async function probeAction(target: unknown): Promise<{ ok: true; printer: DiscoveredPrinter } | Fail> {
  return guarded("probe", async () => {
    if (typeof target !== "string" || !target.trim()) return { ok: false as const, error: "Enter an IP address." };
    const result = await probePrinter(target.trim());
    return result.ok ? { ok: true as const, printer: result.data.printer } : { ok: false as const, error: result.error };
  });
}

// ---- Printers --------------------------------------------------------------

// Add (id null) or edit a printer. Names are unique among live printers.
export async function savePrinter(id: unknown, input: unknown): Promise<{ ok: true; id: string } | Fail<PrinterField>> {
  return guarded("save printer", async () => {
    const parsed = printerSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
    const data = { ...parsed.data, identity: parsed.data.identity ?? Prisma.JsonNull, model: parsed.data.model ?? null };
    return prisma.$transaction(async (tx) => {
      const clash = await tx.printer.findFirst({ where: { ...live, name: data.name, ...(typeof id === "string" ? { id: { not: id } } : {}) }, select: { id: true } });
      if (clash) return { ok: false as const, error: "Please fix the errors below.", fieldErrors: { name: ["Another printer already has that name."] } };
      if (typeof id === "string") {
        const updated = await tx.printer.updateMany({ where: { id, ...live }, data });
        if (updated.count === 0) return { ok: false as const, error: "That printer is no longer there — refreshed." };
        // An OS printer can't stay on Reports if it stops being one.
        if (data.connection !== "OS") {
          await tx.printerAssignment.deleteMany({ where: { role: REPORTS, printerId: id } });
          await tx.printerAssignment.updateMany({ where: { role: REPORTS, fallbackPrinterId: id }, data: { fallbackPrinterId: null } });
        }
        refresh();
        return { ok: true as const, id };
      }
      const created = await tx.printer.create({ data, select: { id: true } });
      refresh();
      return { ok: true as const, id: created.id };
    });
  });
}

// Remove a printer — not while it prints for a role (change that first).
export async function deletePrinter(id: unknown): Promise<{ ok: true } | Fail> {
  return guarded("delete printer", async () => {
    if (typeof id !== "string") return { ok: false as const, error: "Unknown printer." };
    return prisma.$transaction(async (tx) => {
      const uses = await tx.printerAssignment.count({ where: { printerId: id } });
      if (uses > 0) return { ok: false as const, error: "It's assigned to a role — choose another printer there first." };
      await tx.printerAssignment.updateMany({ where: { fallbackPrinterId: id }, data: { fallbackPrinterId: null } });
      await tx.deviceOverride.deleteMany({ where: { printerId: id } });
      const removed = await tx.printer.updateMany({ where: { id, ...live }, data: { deletedAt: new Date() } });
      if (removed.count === 0) return { ok: false as const, error: "That printer is no longer there — refreshed." };
      refresh();
      return { ok: true as const };
    });
  });
}

// A test page (lib/hardware/testPrint.ts), through the print queue like
// every print; waits for it, so the screen can say how it went.
export async function testPrint(id: unknown): Promise<{ ok: true } | Fail> {
  return guarded("test print", async () => {
    if (typeof id !== "string") return { ok: false as const, error: "Unknown printer." };
    const printer = await prisma.printer.findFirst({ where: { id, ...live } });
    if (!printer) return { ok: false as const, error: "That printer is no longer there — refreshed." };
    const user = await requirePermission(PERMISSIONS.MANAGE_SETTING);
    const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date());
    const queued = await enqueuePrint({
      type: "TEST",
      printerId: printer.id,
      label: `Test page · ${printer.name}`,
      template: "TEST",
      data: { name: printer.name, connection: printer.connection, address: printer.address, when },
      createdById: user.userId ?? null,
      deviceId: await currentDeviceId(),
    });
    if (!queued.queued) return { ok: false as const, error: "That printer is no longer there — refreshed." };
    const done = await waitForJob(queued.jobId);
    if (done.status === "DONE") return { ok: true as const };
    if (done.status === "FAILED") return { ok: false as const, error: `Test print failed: ${(done.error ?? "").replace(/^Try \d of \d failed: /, "")}` };
    return { ok: false as const, error: `Test print is waiting in the queue: ${(done.error ?? "the printer hasn't answered yet").replace(/^Try \d of \d failed: /, "")}` };
  });
}

// Test drawer: kicks the drawer on this printer (logged as a Test in the
// drawer log) and says whether the printer took it.
export async function testDrawer(id: unknown): Promise<{ ok: true } | Fail> {
  return guarded("test drawer", async () => {
    if (typeof id !== "string") return { ok: false as const, error: "Unknown printer." };
    const printer = await prisma.printer.findFirst({ where: { id, ...live }, select: { id: true, openDrawer: true } });
    if (!printer) return { ok: false as const, error: "That printer is no longer there — refreshed." };
    if (!printer.openDrawer) return { ok: false as const, error: "Tick “A cash drawer is plugged into this printer” on it first (Edit)." };
    const user = await requirePermission(PERMISSIONS.MANAGE_SETTING);
    const opened = await openDrawer({ reason: "TEST", printerId: printer.id, userId: user.userId ?? null, deviceId: await currentDeviceId() });
    if (!opened.sent) return { ok: false as const, error: "Tick “A cash drawer is plugged into this printer” on it first (Edit)." };
    const done = await waitForJob(opened.jobId);
    const why = (done.error ?? "").replace(/^Try \d of \d failed: /, "");
    if (done.status === "DONE") return { ok: true as const };
    if (done.status === "FAILED" || done.status === "CANCELLED") return { ok: false as const, error: `The drawer didn't open: ${why}` };
    return { ok: false as const, error: `The drawer kick is waiting: ${why || "the printer hasn't answered yet"}` };
  });
}

// The saved printers' status now (the list polls it); remembered on each.
export async function printerStatusAction(): Promise<{ ok: true; statuses: Record<string, PrinterStatusOf> } | Fail> {
  return guarded("printer status", async () => {
    const printers = await prisma.printer.findMany({ where: live, select: { id: true, connection: true, address: true } });
    if (printers.length === 0) return { ok: true as const, statuses: {} };
    const result = await printerStatuses(printers);
    if (!result.ok) return { ok: false as const, error: result.error };
    const now = new Date();
    await Promise.all(
      Object.entries(result.data.statuses).map(([pid, s]) =>
        prisma.printer.updateMany({ where: { id: pid }, data: { lastStatus: s.status, ...(s.status === "ONLINE" || s.status === "PAPER_OUT" ? { lastSeenAt: now } : {}) } }),
      ),
    );
    return { ok: true as const, statuses: result.data.statuses };
  });
}

// ---- Assignments -----------------------------------------------------------

// The whole grid at once. Roles must be ones the grid shows; printers must
// exist; Reports takes OS printers only; a fallback isn't the main printer.
export async function saveAssignments(input: unknown): Promise<{ ok: true } | Fail> {
  return guarded("save assignments", async () => {
    const parsed = assignmentsSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "That grid isn't valid." };
    const roles = new Map((await printerRoles()).map((r) => [r.role, r]));
    const printers = new Map((await prisma.printer.findMany({ where: live, select: { id: true, name: true, connection: true } })).map((p) => [p.id, p]));
    for (const row of parsed.data.rows) {
      const role = roles.get(row.role);
      if (!role) return { ok: false as const, error: "One of those roles no longer exists — refreshed." };
      for (const pid of [row.printerId, row.fallbackPrinterId]) {
        if (pid && !printers.has(pid)) return { ok: false as const, error: "One of those printers was removed — refreshed." };
      }
      if (row.fallbackPrinterId && !row.printerId) return { ok: false as const, error: `${role.label}: choose its printer before a fallback.` };
      if (row.fallbackPrinterId && row.fallbackPrinterId === row.printerId) return { ok: false as const, error: `${role.label}: the fallback must be a different printer.` };
      if (role.kind === "reports") {
        for (const pid of [row.printerId, row.fallbackPrinterId]) {
          if (pid && printers.get(pid)?.connection !== "OS") return { ok: false as const, error: `Reports print through the system dialog — choose an OS printer (${printers.get(pid)?.name} isn't one).` };
        }
      }
    }
    await prisma.$transaction(async (tx) => {
      for (const row of parsed.data.rows) {
        const stationId = row.role.startsWith("STATION:") ? row.role.slice("STATION:".length) : null;
        if (!row.printerId) {
          await tx.printerAssignment.deleteMany({ where: { role: row.role } });
          continue;
        }
        const data = { printerId: row.printerId, fallbackPrinterId: row.fallbackPrinterId, copies: roles.get(row.role)?.kind === "station" ? row.copies : 1, stationId };
        await tx.printerAssignment.upsert({ where: { businessId_role: { businessId: "default", role: row.role } }, create: { role: row.role, ...data }, update: data });
      }
    });
    refresh();
    return { ok: true as const };
  });
}

// ---- Devices ---------------------------------------------------------------

// A device's name and its overrides (Receipt / Pre-bill on its own printer).
export async function saveDevice(input: unknown): Promise<{ ok: true } | Fail> {
  return guarded("save device", async () => {
    const parsed = deviceSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "That device isn't valid." };
    const { id, name, overrides } = parsed.data;
    if (overrides.some((o) => !(DEVICE_ROLES as readonly string[]).includes(o.role))) return { ok: false as const, error: "Devices can only override Receipt and Pre-bill." };
    const wanted = overrides.filter((o) => o.printerId).map((o) => o.printerId as string);
    if (wanted.length && (await prisma.printer.count({ where: { id: { in: wanted }, ...live } })) !== new Set(wanted).size) {
      return { ok: false as const, error: "One of those printers was removed — refreshed." };
    }
    return prisma.$transaction(async (tx) => {
      const updated = await tx.device.updateMany({ where: { id }, data: { name } });
      if (updated.count === 0) return { ok: false as const, error: "That device is no longer listed — refreshed." };
      for (const o of overrides) {
        if (o.printerId) await tx.deviceOverride.upsert({ where: { deviceId_role: { deviceId: id, role: o.role } }, create: { deviceId: id, role: o.role, printerId: o.printerId }, update: { printerId: o.printerId } });
        else await tx.deviceOverride.deleteMany({ where: { deviceId: id, role: o.role } });
      }
      refresh();
      return { ok: true as const };
    });
  });
}

export async function forgetDevice(id: unknown): Promise<{ ok: true } | Fail> {
  return guarded("forget device", async () => {
    if (typeof id !== "string") return { ok: false as const, error: "Unknown device." };
    await prisma.device.deleteMany({ where: { id } });
    refresh();
    return { ok: true as const };
  });
}
