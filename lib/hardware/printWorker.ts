import type { PrintJob, Printer } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolvePrinter } from "./assignments";
import { printerStatuses, printRaw, type PrinterStatusOf } from "./bridgeClient";
import { DRAWER_TTL_MS, drawerBytes } from "./drawerKick";
import type { CodePage, Cut } from "./escpos";
import { loadTicketLook } from "./ticketLook";
import { renderTicket } from "./tickets";

// The print worker: runs in the app server (started from instrumentation.ts
// with the bridge), every TICK_MS and whenever a job is queued. For each
// printer with queued jobs, in order:
//
//   offline / paper out   its jobs wait (no attempts used up) — or, when
//                         the job's role has a fallback that's up, move
//                         there (REROUTED FROM <printer> on the ticket)
//   up                    the oldest job is claimed (QUEUED → PRINTING, so
//                         two workers can't both print it), rendered for
//                         this printer, sent; DONE, then the next. A send
//                         that fails is tried again after 2s, 8s, 30s; the
//                         third failure marks it FAILED (the badges and the
//                         queue screen show it; Retry puts it back)
//   strict order          a job waiting for its retry holds the ones behind
//                         it, so a printer never prints out of order
//   drawer kicks          (DRAWER jobs, drawerKick.ts) aren't tickets: they
//                         go before the tickets waiting on their printer,
//                         never move to a fallback (no role), and are
//                         dropped (CANCELLED) once DRAWER_TTL_MS old — the
//                         drawer never opens late
//
// A job found PRINTING when the worker starts was cut off mid-print: it's
// marked FAILED ("check the printer, then Retry") rather than printed again
// unseen — never a duplicate.

const TICK_MS = 1500;
const BACKOFF_MS = [2000, 8000, 30000];
export const MAX_ATTEMPTS = 3;
const STATUS_TTL_MS = 3000;

type WorkerState = { timer: NodeJS.Timeout | null; running: boolean; again: boolean; status: Map<string, { at: number; value: PrinterStatusOf }> };
const g = globalThis as typeof globalThis & { __ringzPrintWorker?: WorkerState };

const log = (message: string) => console.log(`[print] ${message}`);
const available = (s: PrinterStatusOf | undefined) => !s || s.status === "ONLINE" || s.status === "UNKNOWN";

export function wakePrintWorker(): void {
  const state = g.__ringzPrintWorker;
  if (!state) return;
  if (state.running) state.again = true;
  else void tick();
}

// Jobs left PRINTING by a server that stopped mid-print: Failed, never
// printed again unseen.
export async function recoverInterrupted(): Promise<number> {
  const cut = await prisma.printJob.updateMany({
    where: { status: "PRINTING" },
    data: { status: "FAILED", error: "Interrupted while printing (the server stopped) — check the printer, then Retry or Reprint." },
  });
  return cut.count;
}

export async function startPrintWorker(): Promise<void> {
  if (g.__ringzPrintWorker) return;
  g.__ringzPrintWorker = { timer: null, running: false, again: false, status: new Map() };
  const cut = await recoverInterrupted();
  if (cut) log(`${cut} job(s) were cut off mid-print and are marked Failed.`);
  g.__ringzPrintWorker.timer = setInterval(() => void tick(), TICK_MS);
  g.__ringzPrintWorker.timer.unref();
  void tick();
}

// Drawer kicks the printer didn't take in time: dropped, never sent late.
export async function expireDrawerKicks(now = Date.now()): Promise<number> {
  const dropped = await prisma.printJob.updateMany({
    where: { type: "DRAWER", status: "QUEUED", createdAt: { lt: new Date(now - DRAWER_TTL_MS) } },
    data: { status: "CANCELLED", error: `Not opened — the printer didn't take it within ${DRAWER_TTL_MS / 1000} seconds.` },
  });
  return dropped.count;
}

// Stops the worker (tests; the server just exits).
export function stopPrintWorker(): void {
  const state = g.__ringzPrintWorker;
  if (state?.timer) clearInterval(state.timer);
  delete g.__ringzPrintWorker;
}

async function statusOf(printers: Printer[]): Promise<Map<string, PrinterStatusOf>> {
  const state = g.__ringzPrintWorker!;
  const now = Date.now();
  const stale = printers.filter((p) => (state.status.get(p.id)?.at ?? 0) < now - STATUS_TTL_MS);
  if (stale.length) {
    const result = await printerStatuses(stale.map((p) => ({ id: p.id, connection: p.connection, address: p.address })));
    for (const p of stale) {
      const value: PrinterStatusOf = result.ok ? (result.data.statuses[p.id] ?? { status: "UNKNOWN", detail: null }) : { status: "UNKNOWN", detail: result.error };
      state.status.set(p.id, { at: now, value });
      if (result.ok && value.status !== p.lastStatus) {
        await prisma.printer.update({ where: { id: p.id }, data: { lastStatus: value.status, ...(available(value) ? { lastSeenAt: new Date() } : {}) } });
      }
    }
  }
  return new Map(printers.map((p) => [p.id, state.status.get(p.id)!.value]));
}

async function tick(): Promise<void> {
  const state = g.__ringzPrintWorker;
  if (!state || state.running) return;
  state.running = true;
  try {
    do {
      state.again = false;
      await expireDrawerKicks();
      const waiting = await prisma.printJob.groupBy({ by: ["printerId"], where: { status: "QUEUED" } });
      if (waiting.length === 0) break;
      const printers = await prisma.printer.findMany({ where: { id: { in: waiting.map((w) => w.printerId) } } });
      const status = await statusOf(printers);
      await Promise.all(printers.map((printer) => runPrinter(printer, status)));
    } while (state.again);
  } catch (error) {
    log(`worker: ${(error as Error).message}`);
  } finally {
    state.running = false;
  }
}

// Jobs on a printer that's down: those whose role has a working fallback move.
async function reroute(printer: Printer, status: Map<string, PrinterStatusOf>) {
  const jobs = await prisma.printJob.findMany({ where: { printerId: printer.id, status: "QUEUED" }, select: { id: true, role: true, deviceId: true, reroutedFromPrinterId: true } });
  if (jobs.length === 0) return;
  const assignments = await prisma.printerAssignment.findMany({ select: { role: true, printerId: true, fallbackPrinterId: true, copies: true } });
  const fallbacks = new Set<string>();
  for (const job of jobs) {
    if (!job.role) continue;
    const resolved = resolvePrinter(job.role, null, assignments, []);
    const fallback = resolved?.fallbackPrinterId && resolved.fallbackPrinterId !== printer.id ? resolved.fallbackPrinterId : null;
    if (fallback) fallbacks.add(fallback);
  }
  const fallbackPrinters = fallbacks.size ? await prisma.printer.findMany({ where: { id: { in: [...fallbacks] }, deletedAt: null } }) : [];
  const fallbackStatus = fallbackPrinters.length ? await statusOf(fallbackPrinters) : new Map<string, PrinterStatusOf>();
  for (const job of jobs) {
    const resolved = job.role ? resolvePrinter(job.role, null, assignments, []) : null;
    const fallback = fallbackPrinters.find((p) => p.id === resolved?.fallbackPrinterId && p.id !== printer.id);
    if (fallback && available(fallbackStatus.get(fallback.id))) {
      const moved = await prisma.printJob.updateMany({
        where: { id: job.id, status: "QUEUED", printerId: printer.id },
        data: { printerId: fallback.id, reroutedFromPrinterId: job.reroutedFromPrinterId ?? printer.id, error: null, nextAttemptAt: new Date() },
      });
      if (moved.count) log(`${printer.name} is ${status.get(printer.id)?.status.toLowerCase()} — job ${job.id} rerouted to ${fallback.name}.`);
      wakeAgain();
    } else {
      await prisma.printJob.updateMany({
        where: { id: job.id, status: "QUEUED", error: null },
        data: { error: `Waiting — ${printer.name} is ${status.get(printer.id)?.status === "PAPER_OUT" ? "out of paper" : "offline"}.` },
      });
    }
  }
}

const wakeAgain = () => {
  const state = g.__ringzPrintWorker;
  if (state) state.again = true;
};

async function runPrinter(printer: Printer, status: Map<string, PrinterStatusOf>): Promise<void> {
  if (printer.deletedAt) {
    await prisma.printJob.updateMany({ where: { printerId: printer.id, status: "QUEUED" }, data: { status: "FAILED", error: `${printer.name} was removed — reprint it on another printer.` } });
    return;
  }
  if (!available(status.get(printer.id))) return reroute(printer, status);
  // Drawer kicks first: a cashier is waiting at the till.
  for (;;) {
    const kick = await prisma.printJob.findFirst({ where: { printerId: printer.id, status: "QUEUED", type: "DRAWER", nextAttemptAt: { lte: new Date() } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!kick) break;
    const claimed = await prisma.printJob.updateMany({ where: { id: kick.id, status: "QUEUED" }, data: { status: "PRINTING", attempts: { increment: 1 } } });
    if (claimed.count === 0) continue;
    if (!(await printOne({ ...kick, attempts: kick.attempts + 1 }, printer))) return;
  }
  for (;;) {
    const head = await prisma.printJob.findFirst({ where: { printerId: printer.id, status: "QUEUED", type: { not: "DRAWER" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!head) return;
    // Strict order: the oldest job waits for its retry; nothing jumps it.
    if (head.nextAttemptAt.getTime() > Date.now()) return;
    const claimed = await prisma.printJob.updateMany({ where: { id: head.id, status: "QUEUED" }, data: { status: "PRINTING", attempts: { increment: 1 } } });
    if (claimed.count === 0) continue;
    const ok = await printOne({ ...head, attempts: head.attempts + 1 }, printer);
    if (!ok) return;
  }
}

async function reprintMark(job: PrintJob): Promise<string | null> {
  if (!job.reprint) return null;
  if ((job.type === "KOT" || job.type === "KOT_VOID") && job.refId) {
    const kot = await prisma.kot.findUnique({ where: { id: job.refId }, select: { printCount: true } });
    if (kot) return `REPRINT #${kot.printCount + 1}`;
  }
  return "REPRINT";
}

// A drawer kick that can't be sent any more: dropped, not failed (nothing to retry).
async function dropKick(job: PrintJob, why: string): Promise<true> {
  await prisma.printJob.update({ where: { id: job.id }, data: { status: "CANCELLED", error: why } });
  return true;
}

async function printOne(job: PrintJob, printer: Printer): Promise<boolean> {
  let error: string;
  try {
    if (job.type === "DRAWER") {
      if (job.createdAt.getTime() < Date.now() - DRAWER_TTL_MS) return dropKick(job, `Not opened — the printer didn't take it within ${DRAWER_TTL_MS / 1000} seconds.`);
      if (!printer.openDrawer) return dropKick(job, `Not opened — ${printer.name} no longer has a cash drawer set.`);
      const sent = await printRaw({ connection: printer.connection, address: printer.address, baudRate: printer.baudRate }, drawerBytes(printer.drawerPin));
      if (sent.ok) {
        await prisma.printJob.update({ where: { id: job.id }, data: { status: "DONE", printedAt: new Date(), error: null } });
        return true;
      }
      throw new Error(sent.error);
    }
    const rerouted = job.reroutedFromPrinterId ? await prisma.printer.findUnique({ where: { id: job.reroutedFromPrinterId }, select: { name: true } }) : null;
    const bytes = renderTicket(
      job.template,
      job.data,
      { paperWidth: printer.paperWidth, codePage: printer.codePage as CodePage, cut: printer.cut as Cut, reprint: await reprintMark(job), reroutedFrom: rerouted?.name ?? null, look: await loadTicketLook() },
      job.copies,
    );
    const sent = await printRaw({ connection: printer.connection, address: printer.address, baudRate: printer.baudRate }, bytes);
    if (sent.ok) {
      await prisma.printJob.update({ where: { id: job.id }, data: { status: "DONE", printedAt: new Date(), error: null } });
      if ((job.type === "KOT" || job.type === "KOT_VOID") && job.refId) {
        await prisma.kot.updateMany({ where: { id: job.refId }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
      }
      return true;
    }
    error = sent.error;
  } catch (e) {
    error = (e as Error).message;
  }
  // The printer failed us: it's offline as far as the next tick is concerned.
  g.__ringzPrintWorker?.status.delete(printer.id);
  if (job.attempts >= MAX_ATTEMPTS) {
    await prisma.printJob.update({ where: { id: job.id }, data: { status: "FAILED", error: error.slice(0, 500) } });
    log(`job ${job.id} (${job.label}) FAILED on ${printer.name}: ${error}`);
  } else {
    await prisma.printJob.update({
      where: { id: job.id },
      data: { status: "QUEUED", error: `Try ${job.attempts} of ${MAX_ATTEMPTS} failed: ${error}`.slice(0, 500), nextAttemptAt: new Date(Date.now() + BACKOFF_MS[job.attempts - 1]) },
    });
  }
  return false;
}
