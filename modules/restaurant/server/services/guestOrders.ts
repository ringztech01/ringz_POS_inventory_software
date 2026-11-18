import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { writeAudit } from "@/lib/audit";
import { formatNaira } from "@/lib/format";
import {
  capProblem,
  cleanGuestName,
  guestMode,
  guestStage,
  refuseSend,
  GUEST_POINT_SENDS_PER_WINDOW,
  GUEST_SEND_WINDOW_MS,
  POINT_NOTE,
  type GuestMode,
  type GuestOrderView,
  type GuestWhere,
  type MenuOrdering,
  type PendingGuestLine,
} from "../../lib/guestOrdering";
import { EDITABLE_ORDER_STATUSES, lineDetail, readModifiers, type ChosenModifier } from "../../lib/orderLines";
import { linePrice } from "../../lib/orderTotals";
import { looksLikeToken } from "../../lib/publicMenu";
import { tableStatus } from "../../lib/tableStatus";
import { formatAppTime } from "../../lib/time";
import { heldOrders, lockTable, tableTransaction } from "../locks";
import { dishesInStock } from "../menuStock";
import { tableStateSelect } from "../queries/tables";
import { getTableStatusRules } from "../rules";
import { sendNewLines } from "./kots";
import { chooseOptions, loadDish, type Dish } from "./orderLines";
import { clearSplit, hasPaidPart, lockOrderAt, markBillChanged, type OrderChangeResult } from "./orders";
import { printNewKots } from "./printing";

// Guest ordering (Part 8 Step 7). A guest's Send to waiter from the table's
// menu, checked and priced here exactly as the POS's Add to order is (the
// same dish loader, option rules, stock rule and price), then — by the
// menu's settings (lib/guestOrdering.ts guestMode) — held for a waiter to
// confirm, put on the order as New lines, or sent straight to the kitchen.
// Staff confirm or reject held lines from the order screens and the
// tables screen. Guests never void, discount or pay.

export const GUEST_ERRORS = {
  gone: "This QR code is no longer active. Please ask your waiter.",
  off: "Ordering from the menu isn't available right now. Please ask your waiter.",
  paused: "Ordering from the menu is paused right now. Please ask your waiter.",
  notLan: "Orders can only be sent on the restaurant's Wi-Fi.",
  tooSoon: "Please wait a moment before sending again.",
  tooMany: "That's a lot of orders in a short time. Please ask your waiter.",
  empty: "Your order is empty.",
  lines: (max: number) => `At most ${max} lines in one order. Please ask your waiter for more.`,
  value: "That order is more than the menu can take. Please ask your waiter.",
  seat: "Please ask your waiter to seat you first.",
  paying: "Your bill is being paid, so nothing more can be added. Please ask your waiter.",
  notListed: (name: string) => `${name} isn't on the menu any more.`,
  unavailable: (name: string) => `${name} is currently unavailable.`,
  soldOut: (name: string) => `${name} is sold out.`,
  options: (name: string, problem: string) => `${name}: ${problem}`,
  name: "Please give a name for your order.",
} as const;

export type GuestLineInput = { productId: string; modifierIds: string[]; note: string; quantity: number };
export type GuestDevice = { id: string; ip: string; userAgent: string };

const settingsSelect = {
  menuEnabled: true,
  guestOrderingEnabled: true,
  guestOrderingPausedAt: true,
  requireWaiterConfirm: true,
  autoSendGuestOrders: true,
  guestOrderMaxLines: true,
  guestOrderMaxValue: true,
  menuBaseUrl: true,
} as const;

export async function orderingSettings() {
  const s = await prisma.menuSettings.findUnique({ where: { businessId: BUSINESS_SETTINGS_ID }, select: settingsSelect });
  return {
    menuEnabled: s?.menuEnabled ?? true,
    enabled: s?.guestOrderingEnabled ?? false,
    paused: !!s?.guestOrderingPausedAt,
    mode: guestMode({ autoSendGuestOrders: s?.autoSendGuestOrders ?? false, requireWaiterConfirm: s?.requireWaiterConfirm ?? true }),
    maxLines: s?.guestOrderMaxLines ?? 20,
    maxValue: s ? (s.guestOrderMaxValue?.toFixed(2) ?? null) : "100000.00",
    savedHost: s?.menuBaseUrl ? safeHost(s.menuBaseUrl) : null,
  };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// What a menu offers: ordering (and whether it's paused), or null.
export type GuestOrdering = MenuOrdering;

// Where a code's orders go: a live table (in a live area), or a live QR
// point (Step 8) — a takeaway counter or the bar, stocked from the
// restaurant's warehouse (BusinessSetting.restaurantWarehouseId; none set:
// a point takes no orders).
type PointPlace = { kind: "point"; id: string; where: Exclude<GuestWhere, "table">; orderType: "TAKEAWAY" | "BAR_TAB"; warehouseId: string | null };
type Place = { kind: "table"; id: string } | PointPlace;

async function livePlace(token: string): Promise<Place | null> {
  if (!looksLikeToken(token)) return null;
  const [table, point] = await Promise.all([
    prisma.table.findFirst({ where: { qrToken: token, deletedAt: null, area: { deletedAt: null } }, select: { id: true } }),
    prisma.qrPoint.findFirst({ where: { qrToken: token, deletedAt: null }, select: { id: true, orderType: true } }),
  ]);
  if (table) return { kind: "table", id: table.id };
  if (!point || (point.orderType !== "TAKEAWAY" && point.orderType !== "BAR_TAB")) return null;
  const setting = await prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantWarehouseId: true } });
  return { kind: "point", id: point.id, where: point.orderType === "BAR_TAB" ? "bar" : "takeaway", orderType: point.orderType, warehouseId: setting?.restaurantWarehouseId ?? null };
}

const whereOf = (place: Place): GuestWhere => (place.kind === "table" ? "table" : place.where);
const takesOrders = (place: Place) => place.kind === "table" || !!place.warehouseId;

export async function guestOrderingFor(token: string): Promise<GuestOrdering | null> {
  const [place, settings] = await Promise.all([livePlace(token), orderingSettings()]);
  if (!place || !takesOrders(place) || !settings.menuEnabled || !settings.enabled) return null;
  return { paused: settings.paused, mode: settings.mode, maxLines: settings.maxLines, where: whereOf(place) };
}

export type PlaceResult =
  | { ok: true; orderId: string; sendId: string; mode: GuestMode; lines: number }
  | { ok: false; error: string; status: number; productId?: string };

// The order a guest's lines go on, with the table locked: this phone's own
// open check there, else the table's first real (not training) open check,
// else a new check the guest will open (source GUEST, no waiter yet) — as
// long as the table could be seated (not reserved, not waiting for
// cleaning). Nothing is written here: a new check is opened only once every
// line has passed (openGuestCheck), so a refused order leaves no trace.
type Target = { ok: true; id: string | null; warehouseId: string; checkNumber: number } | { ok: false; error: string; status: number };

async function pickOrder(tx: Prisma.TransactionClient, tableId: string, deviceId: string, now: Date): Promise<Target> {
  const open = await tx.order.findMany({ where: { activeTableId: tableId, deletedAt: null, training: false }, select: { id: true, warehouseId: true }, orderBy: [{ openedAt: "asc" }, { number: "asc" }] });
  if (open.length) {
    const mine = await tx.guestOrderLine.findFirst({ where: { deviceId, orderId: { in: open.map((o) => o.id) } }, orderBy: { createdAt: "desc" }, select: { orderId: true } });
    const order = open.find((o) => o.id === mine?.orderId) ?? open[0];
    return { ok: true, id: order.id, warehouseId: order.warehouseId, checkNumber: 0 };
  }
  const rules = await getTableStatusRules();
  const table = await tx.table.findUniqueOrThrow({ where: { id: tableId }, select: { area: { select: { warehouseId: true } }, ...tableStateSelect(now, rules) } });
  const held = await heldOrders(tx, tableId);
  const state = tableStatus(table, rules, now);
  // Only training checks on it (Part 6f): the guest's is a real one beside them.
  if (!held.length && (state?.status === "Reserved" || state?.status === "Cleaning")) return { ok: false, error: GUEST_ERRORS.seat, status: 409 };
  const taken = held.map((o) => o.checkNumber ?? 1);
  return { ok: true, id: null, warehouseId: table.area.warehouseId, checkNumber: taken.length ? Math.max(...taken) + 1 : 1 };
}

// At a QR point: this phone's own open order from it (its later sends go on
// the same takeaway or tab), else a new one, opened once every line passes.
async function pickPointOrder(tx: Prisma.TransactionClient, token: string, place: PointPlace, deviceId: string): Promise<Target> {
  const mine = await tx.guestOrderLine.findFirst({
    where: { deviceId, qrToken: token, order: { deletedAt: null, tableId: null, training: false, type: place.orderType, status: { in: [...EDITABLE_ORDER_STATUSES] } } },
    orderBy: { createdAt: "desc" },
    select: { order: { select: { id: true, warehouseId: true } } },
  });
  if (mine) return { ok: true, id: mine.order.id, warehouseId: mine.order.warehouseId, checkNumber: 0 };
  return { ok: true, id: null, warehouseId: place.warehouseId ?? "", checkNumber: 0 };
}

// A QR point's new order: a takeaway or a bar tab in the guest's name, with
// the note the POS shows ("Pay at counter" / "Pay at the bar").
async function openPointOrder(tx: Prisma.TransactionClient, place: PointPlace, warehouseId: string, name: string): Promise<string> {
  const order = await tx.order.create({
    data: { type: place.orderType, status: "OPEN", tableId: null, warehouseId, waiterId: null, guests: 1, tabName: name, notes: POINT_NOTE[place.where], source: "GUEST", training: false },
    select: { id: true },
  });
  return order.id;
}

async function lockPoint(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM QrPoint WHERE id = ${id} AND deletedAt IS NULL FOR UPDATE`;
  return rows.length > 0;
}

async function openGuestCheck(tx: Prisma.TransactionClient, tableId: string, warehouseId: string, checkNumber: number): Promise<string> {
  const order = await tx.order.create({
    data: { type: "DINE_IN", status: "OPEN", tableId, warehouseId, waiterId: null, guests: 1, checkNumber, source: "GUEST", training: false },
    select: { id: true },
  });
  return order.id;
}

// The order row, locked; refused once it's closed or a part of it is paid.
async function lockForGuest(tx: Prisma.TransactionClient, orderId: string): Promise<{ ok: true; status: OrderStatus; warehouseId: string } | { ok: false; error: string; status: number }> {
  const rows = await tx.$queryRaw<{ status: OrderStatus; warehouseId: string }[]>`
    SELECT status, warehouseId FROM \`Order\` WHERE id = ${orderId} AND deletedAt IS NULL FOR UPDATE`;
  const row = rows[0];
  if (!row || !EDITABLE_ORDER_STATUSES.includes(row.status)) return { ok: false, error: GUEST_ERRORS.paying, status: 409 };
  if (await hasPaidPart(tx, orderId)) return { ok: false, error: GUEST_ERRORS.paying, status: 409 };
  return { ok: true, status: row.status, warehouseId: row.warehouseId };
}

type Priced = { input: GuestLineInput; dish: Dish; chosen: ChosenModifier[]; unitPrice: Prisma.Decimal };

// A guest's Send to waiter. Prices come from here, never the phone. At a
// QR point (Step 8) the guest's `rawName` names the order.
export async function placeGuestOrder(token: string, lines: GuestLineInput[], device: GuestDevice, now = new Date(), rawName: unknown = null): Promise<PlaceResult> {
  const [place, settings] = await Promise.all([livePlace(token), orderingSettings()]);
  if (!place) return { ok: false, error: GUEST_ERRORS.gone, status: 404 };
  if (!settings.menuEnabled || !settings.enabled || !takesOrders(place)) return { ok: false, error: GUEST_ERRORS.off, status: 403 };
  if (settings.paused) return { ok: false, error: GUEST_ERRORS.paused, status: 403 };
  const early = capProblem({ lines: lines.length, value: "0", maxLines: settings.maxLines, maxValue: null });
  if (early) return { ok: false, error: early.kind === "empty" ? GUEST_ERRORS.empty : GUEST_ERRORS.lines(settings.maxLines), status: 400 };
  const name = place.kind === "point" ? cleanGuestName(rawName) : null;
  if (place.kind === "point" && !name) return { ok: false, error: GUEST_ERRORS.name, status: 400 };

  const result = await tableTransaction(async (tx): Promise<PlaceResult & { kotIds?: string[] }> => {
    const placeLocked = place.kind === "table" ? !!(await lockTable(tx, place.id)) : await lockPoint(tx, place.id);
    if (!placeLocked) return { ok: false, error: GUEST_ERRORS.gone, status: 404 };
    // The earlier sends (the table or point row is locked: two phones can't
    // both slip under the limit). A table's code: the limit is the code's.
    // A QR point's, shared by everyone at the counter: per phone, plus a
    // looser one for the code.
    const since = new Date(now.getTime() - GUEST_SEND_WINDOW_MS);
    const sendTimes = async (where: Prisma.GuestOrderLineWhereInput) =>
      (await tx.guestOrderLine.groupBy({ by: ["sendId"], where: { ...where, createdAt: { gt: since } }, _min: { createdAt: true } })).flatMap((s) => (s._min.createdAt ? [s._min.createdAt] : []));
    const refusal =
      place.kind === "table"
        ? refuseSend(await sendTimes({ qrToken: token }), now)
        : (refuseSend(await sendTimes({ qrToken: token, deviceId: device.id }), now) ?? refuseSend(await sendTimes({ qrToken: token }), now, GUEST_POINT_SENDS_PER_WINDOW, 0));
    if (refusal) return { ok: false, error: refusal === "too_soon" ? GUEST_ERRORS.tooSoon : GUEST_ERRORS.tooMany, status: 429 };

    // Every dish and option first, so nothing is opened for a refused order.
    const ids = [...new Set(lines.map((l) => l.productId))];
    const listed = new Set((await tx.product.findMany({ where: { id: { in: ids }, productType: "MENU_ITEM", deletedAt: null, showOnMenu: true }, select: { id: true } })).map((p) => p.id));
    const dishes = new Map<string, Dish>();
    for (const id of ids) {
      const dish = listed.has(id) ? await loadDish(tx, id) : null;
      if (!dish) {
        const name = (await tx.product.findUnique({ where: { id }, select: { name: true } }))?.name ?? "A dish";
        return { ok: false, error: GUEST_ERRORS.notListed(name), status: 409, productId: id };
      }
      if (!dish.isAvailable) return { ok: false, error: GUEST_ERRORS.unavailable(dish.name), status: 409, productId: id };
      dishes.set(id, dish);
    }
    const priced: Priced[] = [];
    for (const input of lines) {
      const dish = dishes.get(input.productId)!;
      const options = chooseOptions(dish, input.modifierIds);
      if (!options.ok) return { ok: false, error: GUEST_ERRORS.options(dish.name, options.error), status: 400, productId: dish.id };
      priced.push({ input, dish, chosen: options.chosen, unitPrice: linePrice(dish.price.toString(), options.chosen.map((m) => m.price)) });
    }
    const value = priced.reduce((sum, p) => sum.plus(p.unitPrice.times(p.input.quantity)), new Prisma.Decimal(0));
    const cap = capProblem({ lines: priced.length, value: value.toFixed(2), maxLines: settings.maxLines, maxValue: settings.maxValue });
    if (cap) return { ok: false, error: cap.kind === "value" ? GUEST_ERRORS.value : cap.kind === "empty" ? GUEST_ERRORS.empty : GUEST_ERRORS.lines(settings.maxLines), status: 400 };

    const picked = place.kind === "table" ? await pickOrder(tx, place.id, device.id, now) : await pickPointOrder(tx, token, place, device.id);
    if (!picked.ok) return picked;
    // An open check: locked, and refused once its bill is being paid.
    const locked = picked.id ? await lockForGuest(tx, picked.id) : null;
    if (locked && !locked.ok) return locked;
    const inStock = await dishesInStock(tx, [...dishes.values()], picked.warehouseId);
    const out = [...dishes.values()].find((d) => !inStock.has(d.id));
    if (out) return { ok: false, error: GUEST_ERRORS.soldOut(out.name), status: 409, productId: out.id };
    // Every line has passed: now the check, if the guest is opening one.
    const target = picked.id
      ? { id: picked.id, created: false }
      : { id: place.kind === "table" ? await openGuestCheck(tx, place.id, picked.warehouseId, picked.checkNumber) : await openPointOrder(tx, place, picked.warehouseId, name ?? ""), created: true };
    const orderStatus = locked?.ok ? locked.status : "OPEN";

    const sendId = randomBytes(12).toString("base64url");
    const log = { sendId, qrToken: token, deviceId: device.id, ipAddress: device.ip.slice(0, 64), userAgent: device.userAgent.slice(0, 255) };
    const row = (p: Priced) => ({
      productId: p.dish.id,
      quantity: p.input.quantity,
      unitPrice: p.unitPrice.toFixed(2),
      taxType: p.dish.taxType,
      taxRate: p.dish.orderTax ?? 0,
      modifiers: p.chosen.length ? p.chosen : undefined,
      note: p.input.note.trim() || null,
    });

    let kotIds: string[] = [];
    if (settings.mode === "confirm") {
      // Held for a waiter: not order lines yet, so the order (its bill, its
      // version) doesn't change until one confirms them.
      for (const p of priced) await tx.guestOrderLine.create({ data: { orderId: target.id, ...row(p), ...log, createdAt: now } });
    } else {
      const itemIds: string[] = [];
      for (const p of priced) {
        const item = await tx.orderItem.create({ data: { orderId: target.id, ...row(p), station: p.dish.prepStation ?? "KITCHEN" }, select: { id: true } });
        itemIds.push(item.id);
        await tx.guestOrderLine.create({ data: { orderId: target.id, ...row(p), ...log, status: "CONFIRMED", orderItemId: item.id, decidedAt: now, createdAt: now } });
      }
      let status: { status?: "SENT" } = {};
      if (settings.mode === "auto") {
        const sent = await sendNewLines(tx, target.id, null, itemIds);
        // No kitchen station set up: they stay New for a waiter to send.
        if (sent.ok && sent.sent.length) {
          kotIds = sent.kotIds;
          if (orderStatus === "OPEN" || orderStatus === "SERVED") status = { status: "SENT" };
          await clearSplit(tx, target.id);
        }
      }
      await markBillChanged(tx, target.id);
      await tx.order.update({ where: { id: target.id }, data: { ...status, version: { increment: 1 } } });
    }
    await writeAudit(
      {
        userId: null,
        action: "menu.guest.order",
        entityType: "Order",
        entityId: target.id,
        meta: { sendId, mode: settings.mode, where: whereOf(place), ...(name ? { name } : {}), lines: priced.length, value: value.toFixed(2), opened: target.created, qrToken: token, deviceId: device.id, ip: log.ipAddress, userAgent: log.userAgent },
      },
      tx,
    );
    return { ok: true, orderId: target.id, sendId, mode: settings.mode, lines: priced.length, kotIds };
  });
  if (result.ok && result.kotIds?.length) await printNewKots(result.kotIds, { userId: null, deviceId: null });
  if (!result.ok) return result;
  return { ok: true, orderId: result.orderId, sendId: result.sendId, mode: result.mode, lines: result.lines };
}

// What the guest's phone shows of its own order: each line it sent on this
// table (orders still open, or closed in the last half hour) and where it
// is. Never a staff name, never another phone's lines.

const RECENT_MS = 30 * 60_000;

export async function guestOrderView(token: string, deviceId: string | null, showPrices: boolean, now = new Date()): Promise<GuestOrderView | null> {
  if (!deviceId) return { lines: [] };
  const place = await livePlace(token);
  if (!place) return null;
  const recent = new Date(now.getTime() - RECENT_MS);
  const rows = await prisma.guestOrderLine.findMany({
    where: {
      deviceId,
      ...(place.kind === "point" ? { qrToken: token } : {}),
      order: {
        ...(place.kind === "table" ? { tableId: place.id } : { tableId: null }),
        deletedAt: null,
        // Training mode (Part 6f) never reaches a guest.
        training: false,
        OR: [{ status: { in: [...EDITABLE_ORDER_STATUSES] } }, { closedAt: { gt: recent } }, { status: "CANCELLED", updatedAt: { gt: recent } }],
      },
    },
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      modifiers: true,
      note: true,
      status: true,
      product: { select: { name: true } },
      order: { select: { status: true } },
      orderItem: { select: { quantity: true, kitchenStatus: true, cancelledAt: true, deletedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return {
    lines: rows.map((r) => {
      const quantity = r.orderItem?.quantity ?? r.quantity;
      return {
        id: r.id,
        name: r.product.name,
        quantity,
        detail: lineDetail(readModifiers(r.modifiers), r.note),
        amount: showPrices ? formatNaira(r.unitPrice.times(quantity).toFixed(2)) : null,
        stage: guestStage({
          status: r.status,
          orderOpen: EDITABLE_ORDER_STATUSES.includes(r.order.status),
          item: r.orderItem ? { kitchenStatus: r.orderItem.kitchenStatus, cancelled: !!r.orderItem.cancelledAt || !!r.orderItem.deletedAt } : null,
        }),
      };
    }),
  };
}

// ---- Staff: confirm or reject a guest's held lines.


export async function pendingGuestLines(orderId: string): Promise<PendingGuestLine[]> {
  const rows = await prisma.guestOrderLine.findMany({
    where: { orderId, status: "PENDING" },
    select: { id: true, quantity: true, unitPrice: true, modifiers: true, note: true, createdAt: true, product: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.product.name,
    quantity: r.quantity,
    detail: lineDetail(readModifiers(r.modifiers), r.note),
    amount: formatNaira(r.unitPrice.times(r.quantity).toFixed(2)),
    time: formatAppTime(r.createdAt),
  }));
}

const NONE_PENDING = "Those guest lines were already dealt with — refreshed.";

// Confirm: each held line becomes an ordinary New line at the price the
// guest was shown, for the waiter to send as usual.
export async function confirmGuestLines(orderId: string, version: number, lineIds: readonly string[], userId: string, now = new Date()): Promise<OrderChangeResult> {
  return prisma.$transaction(async (tx): Promise<OrderChangeResult> => {
    const locked = await lockOrderAt(tx, orderId, version);
    if (!locked.ok) return locked;
    const lines = await tx.guestOrderLine.findMany({
      where: { orderId, status: "PENDING", id: { in: [...lineIds] } },
      select: { id: true, productId: true, quantity: true, unitPrice: true, taxType: true, taxRate: true, modifiers: true, note: true, product: { select: { prepStation: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (lines.length === 0) return { ok: false, error: NONE_PENDING, stale: true };
    for (const line of lines) {
      const item = await tx.orderItem.create({
        data: {
          orderId,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxType: line.taxType,
          taxRate: line.taxRate,
          modifiers: line.modifiers ?? undefined,
          note: line.note,
          station: line.product.prepStation ?? "KITCHEN",
        },
        select: { id: true },
      });
      await tx.guestOrderLine.update({ where: { id: line.id }, data: { status: "CONFIRMED", orderItemId: item.id, decidedById: userId, decidedAt: now } });
    }
    await markBillChanged(tx, orderId);
    // The guest's order makes this waiter its waiter, if it had none.
    const { version: next } = await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } }, select: { version: true } });
    await tx.order.updateMany({ where: { id: orderId, waiterId: null }, data: { waiterId: userId } });
    return { ok: true, version: next };
  });
}

export async function rejectGuestLines(orderId: string, lineIds: readonly string[], userId: string, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const { count } = await prisma.guestOrderLine.updateMany({ where: { orderId, status: "PENDING", id: { in: [...lineIds] } }, data: { status: "REJECTED", decidedById: userId, decidedAt: now } });
  if (count === 0) return { ok: false, error: NONE_PENDING };
  await writeAudit({ userId, action: "menu.guest.reject", entityType: "Order", entityId: orderId, meta: { lines: count } });
  return { ok: true };
}

// ---- Settings: the Digital menu's Guest ordering card, the dashboard's pause.

export type GuestOrderingSettings = { enabled: boolean; requireWaiterConfirm: boolean; autoSend: boolean; maxLines: number; maxValue: string | null };

export async function saveGuestOrderingSettings(input: GuestOrderingSettings, userId: string): Promise<{ ok: true }> {
  const before = await prisma.menuSettings.upsert({ where: { businessId: BUSINESS_SETTINGS_ID }, create: { businessId: BUSINESS_SETTINGS_ID }, update: {} });
  const data = {
    guestOrderingEnabled: input.enabled,
    requireWaiterConfirm: input.requireWaiterConfirm,
    autoSendGuestOrders: input.autoSend,
    guestOrderMaxLines: input.maxLines,
    guestOrderMaxValue: input.maxValue,
  };
  await prisma.menuSettings.update({ where: { id: before.id }, data });
  await writeAudit({ userId, action: "menu.ordering.update", entityType: "MenuSettings", entityId: before.id, meta: { ...data } });
  return { ok: true };
}

export async function setGuestOrderingPaused(paused: boolean, userId: string): Promise<{ ok: true; changed: boolean }> {
  const before = await prisma.menuSettings.upsert({ where: { businessId: BUSINESS_SETTINGS_ID }, create: { businessId: BUSINESS_SETTINGS_ID }, update: {} });
  if (!!before.guestOrderingPausedAt === paused) return { ok: true, changed: false };
  await prisma.menuSettings.update({ where: { id: before.id }, data: { guestOrderingPausedAt: paused ? new Date() : null } });
  await writeAudit({ userId, action: paused ? "menu.ordering.pause" : "menu.ordering.resume", entityType: "MenuSettings", entityId: before.id });
  return { ok: true, changed: true };
}
