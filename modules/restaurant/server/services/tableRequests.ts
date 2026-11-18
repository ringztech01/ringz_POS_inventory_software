import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { writeAudit } from "@/lib/audit";
import { looksLikeToken } from "../../lib/publicMenu";
import {
  ACK_CLEARS_MIN,
  OPEN_LAPSES_MIN,
  guestRequests,
  isActive,
  refuseRequest,
  type GuestRequests,
  type TableRequestType,
} from "../../lib/tableRequests";
import { lockTable, tableTransaction } from "../locks";
import { menuSettings } from "./menuQr";

// Service requests (Part 8 Step 6): a guest's Call waiter / Request bill
// (public, from the table's menu) and a waiter's tap on the bell. The rules
// are lib/tableRequests.ts.

// Far enough back to see every request that could still be active.
const LOOK_BACK_MS = (OPEN_LAPSES_MIN + ACK_CLEARS_MIN) * 60_000;

// Which buttons the table's menu shows (none at a QR point, or with the
// menu off).
export type ServiceButtons = { callWaiter: boolean; requestBill: boolean };

async function buttons(): Promise<ServiceButtons & { menuEnabled: boolean }> {
  const settings = await prisma.menuSettings.findUnique({
    where: { businessId: BUSINESS_SETTINGS_ID },
    select: { menuEnabled: true, callWaiterEnabled: true, requestBillEnabled: true },
  });
  return { menuEnabled: settings?.menuEnabled ?? true, callWaiter: settings?.callWaiterEnabled ?? false, requestBill: settings?.requestBillEnabled ?? false };
}

// The live table (in a live area) a token opens — never a QR point.
async function tableFor(token: string): Promise<{ id: string } | null> {
  if (!looksLikeToken(token)) return null;
  return prisma.table.findFirst({ where: { qrToken: token, deletedAt: null, area: { deletedAt: null } }, select: { id: true } });
}

async function recentRequests(db: Prisma.TransactionClient, tableId: string, now: Date) {
  return db.tableRequest.findMany({
    where: { tableId, createdAt: { gt: new Date(now.getTime() - LOOK_BACK_MS) } },
    select: { type: true, status: true, createdAt: true, ackAt: true },
  });
}

// What a table's menu shows: its buttons and where its requests stand.
// Null: no buttons (a QR point, both switched off, the menu off, or the
// code no longer works).
export async function guestServiceState(token: string, now = new Date()): Promise<{ buttons: ServiceButtons; requests: GuestRequests } | null> {
  const [table, settings] = await Promise.all([tableFor(token), buttons()]);
  if (!table || !settings.menuEnabled || (!settings.callWaiter && !settings.requestBill)) return null;
  return { buttons: { callWaiter: settings.callWaiter, requestBill: settings.requestBill }, requests: guestRequests(await recentRequests(prisma, table.id, now), now) };
}

export type GuestRequestResult = { ok: true; requests: GuestRequests } | { ok: false; error: string; status: number };

export const REQUEST_ERRORS = {
  gone: "This QR code is no longer active. Please ask your waiter.",
  off: "This isn't available right now. Please ask your waiter.",
  already: { CALL_WAITER: "A waiter has already been called.", REQUEST_BILL: "The bill has already been asked for." } as Record<TableRequestType, string>,
  tooSoon: "Please wait a minute before asking again.",
} as const;

// A guest's request. The table row is locked while the limits are checked,
// so two taps (or two phones at the table) can't both get through.
export async function createGuestRequest(token: string, type: TableRequestType, now = new Date()): Promise<GuestRequestResult> {
  const [table, settings] = await Promise.all([tableFor(token), buttons()]);
  if (!table) return { ok: false, error: REQUEST_ERRORS.gone, status: 404 };
  const enabled = type === "CALL_WAITER" ? settings.callWaiter : settings.requestBill;
  if (!settings.menuEnabled || !enabled) return { ok: false, error: REQUEST_ERRORS.off, status: 403 };

  return tableTransaction(async (tx): Promise<GuestRequestResult> => {
    if (!(await lockTable(tx, table.id))) return { ok: false, error: REQUEST_ERRORS.gone, status: 404 };
    const recent = await recentRequests(tx, table.id, now);
    const refusal = refuseRequest(type, recent, now);
    if (refusal) return { ok: false, error: refusal === "already" ? REQUEST_ERRORS.already[type] : REQUEST_ERRORS.tooSoon, status: 429 };
    await tx.tableRequest.create({ data: { tableId: table.id, type, createdAt: now } });
    return { ok: true, requests: guestRequests([...recent, { type, status: "OPEN", createdAt: now, ackAt: null }], now) };
  });
}

export type TapResult = { ok: true; status: "ACKNOWLEDGED" | "DONE" } | { ok: false; error: string };

// A waiter's tap on the bell: an OPEN request is acknowledged (they're on
// the way); an acknowledged one is done. `seen` is the status the screen
// showed, so a tap that crossed another waiter's doesn't skip a step.
export async function tapTableRequest(id: string, seen: "OPEN" | "ACKNOWLEDGED", userId: string, now = new Date()): Promise<TapResult> {
  const request = await prisma.tableRequest.findUnique({ where: { id }, select: { status: true, createdAt: true, ackAt: true, ackBy: { select: { firstName: true } } } });
  if (!request || !isActive(request, now)) return { ok: false, error: "That request has already been dealt with." };
  if (request.status !== seen) {
    return { ok: false, error: request.status === "ACKNOWLEDGED" && request.ackBy ? `${request.ackBy.firstName} is already on it.` : "That request has already been dealt with." };
  }
  const next = seen === "OPEN" ? ({ status: "ACKNOWLEDGED", ackById: userId, ackAt: now } as const) : ({ status: "DONE", doneAt: now } as const);
  const changed = await prisma.tableRequest.updateMany({ where: { id, status: seen }, data: next });
  if (changed.count === 0) return { ok: false, error: "That request has already been dealt with." };
  return { ok: true, status: next.status };
}

// Digital menu › the guest buttons (Call waiter, Request bill): both off
// until switched on.
export async function saveServiceButtons(input: ServiceButtons, userId: string): Promise<{ ok: true }> {
  const before = await menuSettings();
  await prisma.menuSettings.update({ where: { id: before.id }, data: { callWaiterEnabled: input.callWaiter, requestBillEnabled: input.requestBill } });
  if (before.callWaiterEnabled !== input.callWaiter || before.requestBillEnabled !== input.requestBill) {
    await writeAudit({ userId, action: "menu.service.update", entityType: "MenuSettings", entityId: before.id, meta: { callWaiter: input.callWaiter, requestBill: input.requestBill } });
  }
  return { ok: true };
}
