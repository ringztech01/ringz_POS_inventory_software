// Part 8 Step 7 against a real database (a throwaway copy): guest ordering.
// Its own area, tables, dishes and options, then a guest's Send to waiter
// as the route and the service take it, and a waiter's Confirm / Reject:
//   - off until switched on; a table's code only;
//   - every dish and option checked as the POS checks them (required
//     groups, min / max, listed, available, in stock) — nothing opened for
//     a refused order;
//   - prices from the server: a price sent by the phone is ignored;
//   - held lines aren't order lines: not on the bill, not sent to the
//     kitchen, until a waiter confirms them; rejected ones say so;
//   - the modes: confirm (default), straight on as New lines, straight to
//     the kitchen (a KOT with no staff author);
//   - per-code send limits, the line and value caps, the pause, the
//     restaurant-network check;
//   - the guest's phone sees its own lines and stages, never staff names or
//     another phone's lines; the tables screens see what's waiting;
//   - a training check is never used; a merge carries held lines;
//   - QR points (Step 8): a takeaway or bar tab in the guest's name, with
//     its note; limits per phone, and the code's own;
//   - module off: 404.
// Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/guestOrders.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { GUEST_DEVICE_COOKIE } from "../lib/guestOrdering";
import { newQrToken } from "../lib/qrToken";
import { getFloor } from "../server/queries/floor";
import { getOrderScreen } from "../server/queries/orderScreen";
import { getCounterOrders } from "../server/queries/posScreen";
import { loadPublicMenu } from "../server/queries/publicMenu";
import { openTableOrder } from "../server/services/floor";
import { sendToKitchen } from "../server/services/orderFlow";
import { addLine } from "../server/services/orderLines";
import { mergeOrders } from "../server/services/tableMoves";
import {
  confirmGuestLines,
  GUEST_ERRORS,
  guestOrderingFor,
  guestOrderView,
  placeGuestOrder,
  rejectGuestLines,
  setGuestOrderingPaused,
  type GuestLineInput,
} from "../server/services/guestOrders";
import { POST as orderRoute } from "../server/routes/menuOrder";
import { GET as statusRoute } from "../server/routes/menuStatus";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const skip = enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database";

type Key = "a" | "b" | "c" | "d" | "e" | "f";
const table = Object.fromEntries((["a", "b", "c", "d", "e", "f"] as Key[]).map((k) => [k, { id: "", token: "" }])) as Record<Key, { id: string; token: string }>;
const dish = { jollof: "", soup: "", soldOut: "", hidden: "", off: "" };
const opt = { small: "", large: "", plantain: "", egg: "" };
let areaId = "";
let warehouseId = "";
let pointToken = "";
let waiter = { id: "", firstName: "", lastName: "" };
let settingsId = "";
let settingsBefore: Record<string, unknown> = {};
let moduleWas = true;
let warehouseWas: string | null = null;
const groupIds: string[] = [];
const started = new Date();

const phone = (id: string) => ({ id, ip: "192.168.1.50", userAgent: "Mozilla/5.0 (test phone)" });
const A = phone("deviceAAAAAAAAAAAAAAAAAA");
const B = phone("deviceBBBBBBBBBBBBBBBBBB");
// Each send a little later than the last (the per-code limit).
let clock = Date.now();
const next = (gapMs = 31_000) => new Date((clock += gapMs));
const jollof = (over: Partial<GuestLineInput> = {}): GuestLineInput => ({ productId: dish.jollof, modifierIds: [opt.large, opt.plantain], note: "no pepper", quantity: 2, ...over });
const soup = (quantity = 1): GuestLineInput => ({ productId: dish.soup, modifierIds: [], note: "", quantity });
const settings = (data: Record<string, unknown>) => prisma.menuSettings.update({ where: { id: settingsId }, data });

const post = (token: string, body: unknown, headers: Record<string, string> = {}) =>
  orderRoute(
    new Request(`http://192.168.1.20:3000/menu/${token}/order`, { method: "POST", headers: { host: "192.168.1.20:3000", "x-forwarded-for": "192.168.1.50", "content-type": "application/json", "user-agent": "Mozilla/5.0 (test phone)", ...headers }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ qrToken: token }) },
  );
const status = (token: string, device: string | null) =>
  statusRoute(new Request(`http://localhost/menu/${token}/status`, { headers: device ? { cookie: `${GUEST_DEVICE_COOKIE}=${device}` } : {} }), { params: Promise.resolve({ qrToken: token }) });
const ordersOn = (tableId: string) => prisma.order.findMany({ where: { tableId }, select: { id: true, source: true, waiterId: true, version: true, status: true, training: true, checkNumber: true }, orderBy: { openedAt: "asc" } });
const guestLinesOf = (orderId: string) => prisma.guestOrderLine.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });

describe("Guest ordering (database copy)", { skip }, () => {
  before(async () => {
    const business = await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true, restaurantWarehouseId: true } });
    moduleWas = business.restaurantEnabled;
    warehouseWas = business.restaurantWarehouseId;
    // No restaurant warehouse here: QR points take no orders (Step 8 has its own part below).
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: true, restaurantWarehouseId: null } });
    const s = await prisma.menuSettings.findFirstOrThrow();
    settingsId = s.id;
    settingsBefore = { menuEnabled: s.menuEnabled, showPrices: s.showPrices, guestOrderingEnabled: s.guestOrderingEnabled, requireWaiterConfirm: s.requireWaiterConfirm, autoSendGuestOrders: s.autoSendGuestOrders, guestOrderMaxLines: s.guestOrderMaxLines, guestOrderMaxValue: s.guestOrderMaxValue, guestOrderingPausedAt: s.guestOrderingPausedAt, menuBaseUrl: s.menuBaseUrl };
    await settings({ menuEnabled: true, showPrices: true, guestOrderingEnabled: false, requireWaiterConfirm: true, autoSendGuestOrders: false, guestOrderMaxLines: 20, guestOrderMaxValue: "100000", guestOrderingPausedAt: null });

    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Guest orders check", warehouseId }, select: { id: true } })).id;
    for (const k of Object.keys(table) as Key[]) {
      table[k].token = newQrToken();
      table[k].id = (await prisma.table.create({ data: { name: `GO${k}${Date.now() % 100000}`, seats: 4, areaId, qrToken: table[k].token }, select: { id: true } })).id;
    }
    pointToken = newQrToken();
    await prisma.qrPoint.create({ data: { name: "GO counter", qrToken: pointToken, orderType: "TAKEAWAY" } });
    waiter = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, trainingMode: false }, select: { id: true, firstName: true, lastName: true }, orderBy: { createdAt: "asc" } });

    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "GO check" }, select: { id: true } })).id;
    const make = async (name: string, price: string, extra: { isAvailable?: boolean; showOnMenu?: boolean; stock?: number } = {}) => {
      const p = await prisma.product.create({
        data: { name, code: `GO-${name}-${Date.now()}`, price, cost: "100", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", isAvailable: extra.isAvailable ?? true, showOnMenu: extra.showOnMenu ?? true },
        select: { id: true },
      });
      await prisma.productStock.create({ data: { productId: p.id, warehouseId, quantity: extra.stock ?? 50 } });
      return p.id;
    };
    dish.jollof = await make("GO Jollof", "1500");
    dish.soup = await make("GO Soup", "2000");
    dish.soldOut = await make("GO Suya", "1800", { stock: 0 });
    dish.hidden = await make("GO Staff meal", "500", { showOnMenu: false });
    dish.off = await make("GO Tilapia", "2600", { isAvailable: false });
    const size = await prisma.modifierGroup.create({ data: { name: "GO Size", minSelect: 1, maxSelect: 1, modifiers: { create: [{ name: "Small", price: 0, sortOrder: 0 }, { name: "Large", price: 500, sortOrder: 1 }] } }, select: { id: true, modifiers: { select: { id: true, name: true } } } });
    const extras = await prisma.modifierGroup.create({ data: { name: "GO Extras", minSelect: 0, maxSelect: 2, sortOrder: 1, modifiers: { create: [{ name: "Plantain", price: 300, sortOrder: 0 }, { name: "Egg", price: 200, sortOrder: 1 }, { name: "Salad", price: 100, sortOrder: 2 }] } }, select: { id: true, modifiers: { select: { id: true, name: true } } } });
    groupIds.push(size.id, extras.id);
    const id = (g: typeof size, name: string) => g.modifiers.find((m) => m.name === name)!.id;
    Object.assign(opt, { small: id(size, "Small"), large: id(size, "Large"), plantain: id(extras, "Plantain"), egg: id(extras, "Egg"), salad: id(extras, "Salad") });
    await prisma.product.update({ where: { id: dish.jollof }, data: { modifierGroups: { connect: [{ id: size.id }, { id: extras.id }] } } });
  });

  after(async () => {
    const tableIds = Object.values(table).map((t) => t.id);
    const orders = (await prisma.order.findMany({ where: { tableId: { in: tableIds } }, select: { id: true } })).map((o) => o.id);
    const kots = (await prisma.kot.findMany({ where: { orderId: { in: orders } }, select: { id: true } })).map((k) => k.id);
    await prisma.printJob.deleteMany({ where: { refId: { in: kots } } });
    await prisma.kotLine.deleteMany({ where: { kotId: { in: kots } } });
    await prisma.kot.deleteMany({ where: { id: { in: kots } } });
    await prisma.guestOrderLine.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.order.deleteMany({ where: { id: { in: orders } } });
    await prisma.table.deleteMany({ where: { id: { in: tableIds } } });
    await prisma.diningArea.delete({ where: { id: areaId } });
    await prisma.qrPoint.deleteMany({ where: { qrToken: pointToken } });
    const products = Object.values(dish);
    await prisma.product.update({ where: { id: dish.jollof }, data: { modifierGroups: { set: [] } } });
    await prisma.modifier.deleteMany({ where: { groupId: { in: groupIds } } });
    await prisma.modifierGroup.deleteMany({ where: { id: { in: groupIds } } });
    await prisma.productStock.deleteMany({ where: { productId: { in: products } } });
    await prisma.product.deleteMany({ where: { id: { in: products } } });
    await prisma.category.deleteMany({ where: { name: "GO check" } });
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: "menu." }, createdAt: { gte: started } } });
    await settings(settingsBefore);
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: moduleWas, restaurantWarehouseId: warehouseWas } });
  });

  test("off until switched on; then a table's code only", async () => {
    assert.deepEqual(await placeGuestOrder(table.a.token, [soup()], A, next()), { ok: false, error: GUEST_ERRORS.off, status: 403 });
    assert.equal(await guestOrderingFor(table.a.token), null);
    const off = await loadPublicMenu(table.a.token);
    assert.equal(off.kind === "menu" && off.ordering, null, "the menu has no Add to order");
    await settings({ guestOrderingEnabled: true });
    assert.deepEqual(await guestOrderingFor(table.a.token), { paused: false, mode: "confirm", maxLines: 20, where: "table" });
    const on = await loadPublicMenu(table.a.token);
    assert.ok(on.kind === "menu" && on.ordering);
    const item = on.kind === "menu" ? on.items.find((i) => i.id === dish.jollof) : undefined;
    assert.equal(item?.kobo, 150000);
    assert.deepEqual(item?.modifiers.map((g) => [g.name, g.min, g.max, g.options.map((o) => o.kobo)]), [["GO Size", 1, 1, [0, 50000]], ["GO Extras", 0, 2, [30000, 20000, 10000]]]);
    assert.equal(await guestOrderingFor(pointToken), null, "a QR point with no restaurant warehouse takes no orders");
    assert.deepEqual(await placeGuestOrder(pointToken, [soup()], A, next(), "Ada"), { ok: false, error: GUEST_ERRORS.off, status: 403 });
    assert.deepEqual(await placeGuestOrder("AAAAAAAAAAAAAAAAAAAAAAAA", [soup()], A, next()), { ok: false, error: GUEST_ERRORS.gone, status: 404 });
  });

  test("every dish and option checked as the POS checks them; nothing opened for a refused order", async () => {
    const refused = async (lines: GuestLineInput[]) => {
      const result = await placeGuestOrder(table.a.token, lines, A, next());
      assert.equal(result.ok, false);
      return result.ok ? "" : result.error;
    };
    assert.equal(await refused([jollof({ modifierIds: [] })]), "GO Jollof: GO Size: pick one.", "a required group");
    assert.equal(await refused([jollof({ modifierIds: [opt.small, opt.large] })]), "GO Jollof: GO Size: pick up to 1.");
    assert.equal(await refused([jollof({ modifierIds: [opt.small, opt.plantain, opt.egg, (opt as Record<string, string>).salad] })]), "GO Jollof: GO Extras: pick up to 2.");
    assert.match(await refused([jollof({ modifierIds: [opt.small, "made-up-option"] })]), /That option isn't available/);
    assert.equal(await refused([soup(), { productId: dish.hidden, modifierIds: [], note: "", quantity: 1 }]), GUEST_ERRORS.notListed("GO Staff meal"));
    assert.equal(await refused([{ productId: dish.off, modifierIds: [], note: "", quantity: 1 }]), GUEST_ERRORS.unavailable("GO Tilapia"));
    assert.equal(await refused([{ productId: dish.soldOut, modifierIds: [], note: "", quantity: 1 }]), GUEST_ERRORS.soldOut("GO Suya"));
    assert.equal(await refused([soup(), { productId: "no-such-dish", modifierIds: [], note: "", quantity: 1 }]), GUEST_ERRORS.notListed("A dish"));
    assert.deepEqual(await ordersOn(table.a.id), [], "no order was opened");
  });

  test("priced by the server: a price from the phone is ignored; held lines aren't on the bill or sent", async () => {
    clock += 31_000;
    const response = await post(table.a.token, { lines: [{ ...jollof(), price: "1", unitPrice: "1", amount: 1 }, { ...soup(1), price: "0.01" }], total: "2" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, mode: "confirm" });
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, new RegExp(`^${GUEST_DEVICE_COOKIE}=[A-Za-z0-9_-]{24}; Path=/menu;.*HttpOnly`));
    const device = cookie.split(";")[0].split("=")[1];
    const [order] = await ordersOn(table.a.id);
    assert.deepEqual([order.source, order.waiterId, order.status], ["GUEST", null, "OPEN"], "the guest opened the table");
    const lines = await guestLinesOf(order.id);
    assert.deepEqual(lines.map((l) => [l.status, l.unitPrice.toFixed(2), l.quantity, l.note]), [["PENDING", "2300.00", 2, "no pepper"], ["PENDING", "2000.00", 1, null]], "1500 + Large 500 + Plantain 300; the soup at 2000");
    assert.deepEqual(lines.map((l) => [l.deviceId, l.qrToken, l.ipAddress, l.userAgent]), [[device, table.a.token, "192.168.1.50", "Mozilla/5.0 (test phone)"], [device, table.a.token, "192.168.1.50", "Mozilla/5.0 (test phone)"]], "logged with the code and the phone");
    assert.equal(await prisma.orderItem.count({ where: { orderId: order.id } }), 0, "not order lines yet");
    const screen = (await getOrderScreen(order.id))!;
    assert.equal(screen.totals.total, "₦0.00", "not on the bill");
    assert.deepEqual(screen.guestLines.map((l) => [l.name, l.quantity, l.amount]), [["GO Jollof", 2, "₦4,600.00"], ["GO Soup", 1, "₦2,000.00"]]);
    const sent = await sendToKitchen(order.id, order.version, waiter.id);
    assert.ok(sent.ok && sent.sent.length === 0, "Send to kitchen has nothing to send");
    assert.equal(await prisma.kot.count({ where: { orderId: order.id } }), 0);
    const audit = await prisma.auditLog.findFirst({ where: { action: "menu.guest.order", entityId: order.id }, select: { userId: true, meta: true } });
    assert.equal(audit?.userId, null);
    assert.equal((audit?.meta as { deviceId?: string } | null)?.deviceId, device);
  });

  test("the guest's phone: its own lines and their stages — never staff, never another phone's", async () => {
    const [order] = await ordersOn(table.a.id);
    const device = (await guestLinesOf(order.id))[0].deviceId;
    const mine = await guestOrderView(table.a.token, device, true);
    assert.deepEqual(mine?.lines.map((l) => [l.name, l.quantity, l.detail, l.amount, l.stage]), [["GO Jollof", 2, "Large · Plantain · no pepper", "₦4,600.00", "waiting"], ["GO Soup", 1, "", "₦2,000.00", "waiting"]]);
    assert.deepEqual((await guestOrderView(table.a.token, B.id, true))?.lines, [], "another phone sees nothing");
    const body = (await (await status(table.a.token, device)).json()) as { order: { paused: boolean; lines: unknown[] } };
    assert.equal(body.order.paused, false);
    assert.equal(body.order.lines.length, 2);
    const text = JSON.stringify(body);
    for (const leak of [waiter.firstName, waiter.id, order.id, "cost", "unitPrice", "deviceId", "ipAddress"]) assert.ok(!text.includes(leak), `no ${leak}`);
    assert.deepEqual(((await (await status(table.a.token, null)).json()) as { order: { lines: unknown[] } }).order.lines, [], "no cookie: no lines");
  });

  test("the tables screens see what's waiting, for everyone while the table has no waiter", async () => {
    const floor = await getFloor(areaId);
    const [order] = await ordersOn(table.a.id);
    const mine = floor.guestOrders.find((g) => g.orderId === order.id);
    assert.deepEqual([mine?.lines, mine?.waiterIds, mine?.tableId], [2, [], table.a.id]);
    assert.equal(floor.tables.find((t) => t.id === table.a.id)?.order?.pending.length, 2);
  });

  test("a waiter confirms: New lines at the guest's price, then sent as usual; a stale screen is refused", async () => {
    const [order] = await ordersOn(table.a.id);
    const lines = await guestLinesOf(order.id);
    assert.equal((await confirmGuestLines(order.id, order.version + 5, [lines[0].id], waiter.id)).ok, false, "the order moved on");
    const confirmed = await confirmGuestLines(order.id, order.version, [lines[0].id], waiter.id);
    assert.ok(confirmed.ok);
    const [item] = await prisma.orderItem.findMany({ where: { orderId: order.id }, select: { id: true, unitPrice: true, quantity: true, kitchenStatus: true, note: true, modifiers: true } });
    assert.deepEqual([item.unitPrice.toFixed(2), item.quantity, item.kitchenStatus, item.note], ["2300.00", 2, "NEW", "no pepper"]);
    assert.deepEqual((item.modifiers as { name: string }[]).map((m) => m.name), ["Large", "Plantain"]);
    const after = await prisma.guestOrderLine.findUniqueOrThrow({ where: { id: lines[0].id } });
    assert.deepEqual([after.status, after.orderItemId, after.decidedById], ["CONFIRMED", item.id, waiter.id]);
    assert.equal((await ordersOn(table.a.id))[0].waiterId, waiter.id, "the confirming waiter takes the table");
    assert.equal((await getOrderScreen(order.id))!.totals.subTotal, "₦4,600.00", "now on the bill");
    const stage = async () => (await guestOrderView(table.a.token, lines[0].deviceId, true))!.lines.map((l) => l.stage);
    assert.deepEqual(await stage(), ["waiting", "waiting"]);
    const version = (await ordersOn(table.a.id))[0].version;
    const sent = await sendToKitchen(order.id, version, waiter.id);
    assert.ok(sent.ok && sent.sent.length === 1);
    assert.deepEqual(await stage(), ["sent", "waiting"]);
    assert.equal((await rejectGuestLines(order.id, [lines[1].id], waiter.id)).ok, true);
    assert.deepEqual(await stage(), ["sent", "rejected"]);
    assert.equal((await rejectGuestLines(order.id, [lines[1].id], waiter.id)).ok, false, "already dealt with");
    assert.equal((await confirmGuestLines(order.id, (await ordersOn(table.a.id))[0].version, [lines[1].id], waiter.id)).ok, false, "a rejected line can't be confirmed");
  });

  test("a second send from the phone goes on its check; the floor's toast is for its waiter now", async () => {
    const result = await placeGuestOrder(table.a.token, [soup(2)], A, next());
    assert.ok(result.ok);
    const orders = await ordersOn(table.a.id);
    assert.equal(orders.length, 1, "same check");
    const floor = await getFloor(areaId);
    assert.deepEqual(floor.guestOrders.find((g) => g.tableId === table.a.id)?.waiterIds, [waiter.id]);
  });

  test("per code: one send every 30 s, at most 6 in 15 minutes", async () => {
    const t0 = clock + 60_000;
    assert.ok((await placeGuestOrder(table.e.token, [soup()], B, new Date(t0))).ok);
    assert.deepEqual(await placeGuestOrder(table.e.token, [soup()], B, new Date(t0 + 10_000)), { ok: false, error: GUEST_ERRORS.tooSoon, status: 429 });
    assert.deepEqual(await placeGuestOrder(table.e.token, [soup()], A, new Date(t0 + 10_000)), { ok: false, error: GUEST_ERRORS.tooSoon, status: 429 }, "per code, not per phone");
    for (let i = 1; i <= 5; i++) assert.ok((await placeGuestOrder(table.e.token, [soup()], B, new Date(t0 + i * 31_000))).ok, `send ${i + 1}`);
    assert.deepEqual(await placeGuestOrder(table.e.token, [soup()], B, new Date(t0 + 6 * 31_000)), { ok: false, error: GUEST_ERRORS.tooMany, status: 429 });
    assert.ok((await placeGuestOrder(table.f.token, [soup()], B, new Date(t0 + 6 * 31_000))).ok, "another table isn't held up");
    clock = t0 + 20 * 60_000;
  });

  test("the caps: lines per order, and its value", async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...soup(), note: `n${i}` }));
    assert.deepEqual(await placeGuestOrder(table.b.token, many, A, next()), { ok: false, error: GUEST_ERRORS.lines(20), status: 400 });
    await settings({ guestOrderMaxValue: "5000" });
    assert.deepEqual(await placeGuestOrder(table.b.token, [soup(3)], A, next()), { ok: false, error: GUEST_ERRORS.value, status: 400 }, "₦6,000 over ₦5,000");
    await settings({ guestOrderMaxValue: null });
    assert.deepEqual(await placeGuestOrder(table.b.token, [], A, next()), { ok: false, error: GUEST_ERRORS.empty, status: 400 });
    await settings({ guestOrderMaxValue: "100000" });
    assert.deepEqual(await ordersOn(table.b.id), []);
  });

  test("waiter confirm off: straight onto the order as New lines, not sent", async () => {
    await settings({ requireWaiterConfirm: false });
    const result = await placeGuestOrder(table.b.token, [jollof({ modifierIds: [opt.small] })], A, next());
    assert.ok(result.ok && result.mode === "direct");
    const [order] = await ordersOn(table.b.id);
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, select: { id: true, kitchenStatus: true, unitPrice: true } });
    assert.deepEqual(items.map((i) => [i.kitchenStatus, i.unitPrice.toFixed(2)]), [["NEW", "1500.00"]]);
    assert.deepEqual((await guestLinesOf(order.id)).map((l) => [l.status, l.orderItemId]), [["CONFIRMED", items[0].id]]);
    assert.equal(await prisma.kot.count({ where: { orderId: order.id } }), 0);
    assert.equal(order.version, 1, "the order's version moved on");
    await settings({ requireWaiterConfirm: true });
  });

  test("auto-send on: straight to the kitchen, a KOT with no staff author", async () => {
    await settings({ autoSendGuestOrders: true });
    const result = await placeGuestOrder(table.c.token, [soup(1), jollof({ modifierIds: [opt.small], quantity: 1 })], A, next());
    assert.ok(result.ok && result.mode === "auto");
    const [order] = await ordersOn(table.c.id);
    assert.equal(order.status, "SENT");
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, select: { kitchenStatus: true, stationId: true } });
    assert.ok(items.length === 2 && items.every((i) => i.kitchenStatus === "PENDING" && i.stationId));
    const kots = await prisma.kot.findMany({ where: { orderId: order.id }, select: { createdById: true } });
    assert.ok(kots.length >= 1 && kots.every((k) => k.createdById === null));
    assert.deepEqual((await guestOrderView(table.c.token, A.id, true))!.lines.map((l) => l.stage), ["sent", "sent"]);
    await settings({ autoSendGuestOrders: false });
  });

  test("a training check on the table is never used: the guest gets a real check beside it", async () => {
    const training = await prisma.order.create({ data: { type: "DINE_IN", status: "OPEN", tableId: table.d.id, warehouseId, waiterId: waiter.id, checkNumber: 1, training: true }, select: { id: true } });
    assert.ok((await placeGuestOrder(table.d.token, [soup()], A, next())).ok);
    const orders = await ordersOn(table.d.id);
    assert.deepEqual(orders.map((o) => [o.training, o.source, o.checkNumber]), [[true, "STAFF", 1], [false, "GUEST", 2]]);
    assert.equal(await prisma.guestOrderLine.count({ where: { orderId: training.id } }), 0);
    // Even a line forced onto the training check (no code path puts one
    // there) never reaches the guest's phone or the tables screens.
    await prisma.orderItem.create({ data: { orderId: training.id, productId: dish.soup, quantity: 3, unitPrice: "2000", taxType: "EXCLUSIVE", taxRate: 0 } });
    await prisma.guestOrderLine.create({ data: { orderId: training.id, sendId: "trainingsend", productId: dish.soup, quantity: 3, unitPrice: "2000", qrToken: table.d.token, deviceId: A.id, ipAddress: "192.168.1.50", userAgent: "test" } });
    const view = await guestOrderView(table.d.token, A.id, true);
    assert.deepEqual(view?.lines.map((l) => l.quantity), [1], "only the guest's own real line");
    const body = JSON.stringify(await (await status(table.d.token, A.id)).json());
    assert.ok(!body.includes("trainingsend") && !body.includes(training.id), "the live check: nothing of the training check");
    const floor = await getFloor(areaId);
    assert.ok(!floor.guestOrders.some((g) => g.orderId === training.id), "the tables screens: no guest order on a training check");
    await prisma.guestOrderLine.deleteMany({ where: { orderId: training.id } });
  });

  test("the guest's price is the POS's: the same dish and options cost the same on both", async () => {
    const pos = await prisma.order.create({ data: { type: "TAKEAWAY", status: "OPEN", warehouseId, waiterId: waiter.id }, select: { id: true } });
    try {
      const added = await addLine({ orderId: pos.id, version: 0, productId: dish.jollof, modifierIds: [opt.large, opt.plantain], note: "", quantity: 1, seat: null, course: null });
      assert.ok(added.ok, added.ok ? "" : added.error);
      const posLine = await prisma.orderItem.findFirstOrThrow({ where: { orderId: pos.id }, select: { unitPrice: true, taxType: true, taxRate: true, modifiers: true } });
      const guestLine = await prisma.guestOrderLine.findFirstOrThrow({ where: { productId: dish.jollof, quantity: 2, note: "no pepper" }, select: { unitPrice: true, taxType: true, taxRate: true, modifiers: true } });
      assert.deepEqual(
        [posLine.unitPrice.toFixed(2), posLine.taxType, posLine.taxRate.toFixed(2), posLine.modifiers],
        [guestLine.unitPrice.toFixed(2), guestLine.taxType, guestLine.taxRate.toFixed(2), guestLine.modifiers],
      );
      assert.equal(posLine.unitPrice.toFixed(2), "2300.00");
    } finally {
      await prisma.orderItem.deleteMany({ where: { orderId: pos.id } });
      await prisma.order.delete({ where: { id: pos.id } });
    }
  });

  test("a merge carries held lines to the order it joins", async () => {
    const [guestOrder] = (await ordersOn(table.f.id)).filter((o) => o.source === "GUEST");
    const opened = await openTableOrder(table.b.id, waiter.id, 2);
    const target = opened.ok ? opened.orderId : (await ordersOn(table.b.id))[0].id;
    const held = await prisma.guestOrderLine.count({ where: { orderId: guestOrder.id, status: "PENDING" } });
    assert.ok(held > 0);
    const merged = await mergeOrders(guestOrder.id, guestOrder.version, target);
    assert.ok(merged.ok, merged.ok ? "" : merged.error);
    assert.equal(await prisma.guestOrderLine.count({ where: { orderId: target, status: "PENDING" } }), held);
  });

  test("paused: the menu stays, sending is refused; resumed", async () => {
    await setGuestOrderingPaused(true, waiter.id);
    assert.deepEqual(await placeGuestOrder(table.a.token, [soup()], A, next()), { ok: false, error: GUEST_ERRORS.paused, status: 403 });
    assert.equal(((await (await status(table.a.token, A.id)).json()) as { order: { paused: boolean } }).order.paused, true);
    const page = await loadPublicMenu(table.a.token);
    assert.equal(page.kind, "menu");
    await setGuestOrderingPaused(false, waiter.id);
    assert.ok((await placeGuestOrder(table.a.token, [soup()], A, next())).ok);
  });

  test("the route: the restaurant's network only, from the menu page, the shape it expects", async () => {
    clock += 60_000;
    assert.equal((await post(table.b.token, { lines: [soup()] }, { host: "41.58.10.2:3000" })).status, 403, "a public address");
    assert.deepEqual(await (await post(table.b.token, { lines: [soup()] }, { "x-forwarded-for": "41.190.3.3" })).json(), { ok: false, error: GUEST_ERRORS.notLan });
    assert.equal((await post(table.b.token, { lines: [soup()] }, { origin: "http://evil.example" })).status, 403);
    assert.equal((await post(table.b.token, { lines: [{ ...soup(), quantity: 0 }] })).status, 400);
    assert.equal((await post(table.b.token, { lines: [{ ...soup(), quantity: 21 }] })).status, 400);
    assert.equal((await post(table.b.token, "not an order")).status, 400);
  });
});

describe("Takeaway and bar points (database copy)", { skip }, () => {
  const point = { takeaway: { id: "", token: "" }, bar: { id: "", token: "" } };
  let soupId = "";
  let warehouse = "";
  let before0: { warehouseId: string | null; settings: Record<string, unknown> } = { warehouseId: null, settings: {} };
  let menuId = "";
  let time = Date.now() + 10 * 60 * 60_000;
  const at = (gap = 31_000) => new Date((time += gap));
  const soupLine = (quantity = 1): GuestLineInput => ({ productId: soupId, modifierIds: [], note: "", quantity });
  const P = phone("pointPhoneAAAAAAAAAAAAAA");
  const Q = phone("pointPhoneBBBBBBBBBBBBBB");
  const pointOrders = (token: string) =>
    prisma.order.findMany({ where: { tableId: null, guestLines: { some: { qrToken: token } } }, select: { id: true, type: true, tabName: true, notes: true, source: true, waiterId: true, status: true }, orderBy: { openedAt: "asc" } });

  before(async () => {
    const setting = await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantWarehouseId: true, restaurantEnabled: true } });
    const s = await prisma.menuSettings.findFirstOrThrow();
    menuId = s.id;
    before0 = { warehouseId: setting.restaurantWarehouseId, settings: { guestOrderingEnabled: s.guestOrderingEnabled, requireWaiterConfirm: s.requireWaiterConfirm, autoSendGuestOrders: s.autoSendGuestOrders, guestOrderingPausedAt: s.guestOrderingPausedAt, menuEnabled: s.menuEnabled } };
    warehouse = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: true, restaurantWarehouseId: null } });
    await prisma.menuSettings.update({ where: { id: menuId }, data: { guestOrderingEnabled: true, requireWaiterConfirm: true, autoSendGuestOrders: false, guestOrderingPausedAt: null, menuEnabled: true } });
    for (const [key, orderType] of [["takeaway", "TAKEAWAY"], ["bar", "BAR_TAB"]] as const) {
      point[key].token = newQrToken();
      point[key].id = (await prisma.qrPoint.create({ data: { name: `PT ${key}`, qrToken: point[key].token, orderType }, select: { id: true } })).id;
    }
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "PT check" }, select: { id: true } })).id;
    soupId = (await prisma.product.create({ data: { name: "PT Pepper soup", code: `PT-${Date.now()}`, price: "2500", cost: "100", orderTax: "0", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", isAvailable: true, showOnMenu: true }, select: { id: true } })).id;
    await prisma.productStock.create({ data: { productId: soupId, warehouseId: warehouse, quantity: 50 } });
  });

  after(async () => {
    const orders = (await prisma.order.findMany({ where: { guestLines: { some: { qrToken: { in: [point.takeaway.token, point.bar.token] } } } }, select: { id: true } })).map((o) => o.id);
    await prisma.guestOrderLine.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.order.deleteMany({ where: { id: { in: orders } } });
    await prisma.qrPoint.deleteMany({ where: { id: { in: [point.takeaway.id, point.bar.id] } } });
    await prisma.productStock.deleteMany({ where: { productId: soupId } });
    await prisma.product.deleteMany({ where: { id: soupId } });
    await prisma.category.deleteMany({ where: { name: "PT check" } });
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: "menu." }, createdAt: { gte: started } } });
    await prisma.menuSettings.update({ where: { id: menuId }, data: before0.settings });
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantWarehouseId: before0.warehouseId } });
  });

  test("a point takes orders once the restaurant's warehouse is set", async () => {
    assert.equal(await guestOrderingFor(point.takeaway.token), null, "no warehouse: no orders");
    assert.deepEqual(await placeGuestOrder(point.takeaway.token, [soupLine()], P, at(), "Ada"), { ok: false, error: GUEST_ERRORS.off, status: 403 });
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantWarehouseId: warehouse } });
    const { guestOrderMaxLines } = await prisma.menuSettings.findFirstOrThrow();
    assert.deepEqual(await guestOrderingFor(point.takeaway.token), { paused: false, mode: "confirm", maxLines: guestOrderMaxLines, where: "takeaway" });
    assert.equal((await guestOrderingFor(point.bar.token))?.where, "bar");
    const page = await loadPublicMenu(point.takeaway.token);
    assert.equal(page.kind === "menu" && page.ordering?.where, "takeaway");
    assert.equal(page.kind === "menu" && page.service, null, "no Call waiter at a counter");
  });

  test("the guest's name is required, and names the takeaway: Pay at counter, no waiter, no table", async () => {
    assert.deepEqual(await placeGuestOrder(point.takeaway.token, [soupLine()], P, at()), { ok: false, error: GUEST_ERRORS.name, status: 400 });
    assert.deepEqual(await placeGuestOrder(point.takeaway.token, [soupLine()], P, at(), "   "), { ok: false, error: GUEST_ERRORS.name, status: 400 });
    assert.deepEqual(await pointOrders(point.takeaway.token), []);
    const sent = await placeGuestOrder(point.takeaway.token, [soupLine(2)], P, at(), "  Ada  ");
    assert.ok(sent.ok);
    const [order] = await pointOrders(point.takeaway.token);
    assert.deepEqual([order.type, order.tabName, order.notes, order.source, order.waiterId, order.status], ["TAKEAWAY", "Ada", "Pay at counter", "GUEST", null, "OPEN"]);
    const screen = (await getOrderScreen(order.id))!;
    assert.deepEqual([screen.order.tableName, screen.order.note, screen.guestLines.length, screen.totals.total], [null, "Pay at counter", 1, "₦0.00"]);
  });

  test("the same phone's next send joins its takeaway; another phone gets its own; limits are per phone", async () => {
    assert.deepEqual(await placeGuestOrder(point.takeaway.token, [soupLine()], P, at(5_000), "Ada"), { ok: false, error: GUEST_ERRORS.tooSoon, status: 429 }, "the same phone, 5 s later");
    assert.ok((await placeGuestOrder(point.takeaway.token, [soupLine()], Q, at(1_000), "Obi")).ok, "another phone at the counter, right away");
    assert.ok((await placeGuestOrder(point.takeaway.token, [soupLine()], P, at(), "Ada again")).ok);
    const orders = await pointOrders(point.takeaway.token);
    assert.deepEqual(orders.map((o) => o.tabName), ["Ada", "Obi"], "Ada's second send went on her takeaway (its name kept)");
    assert.equal(await prisma.guestOrderLine.count({ where: { orderId: orders[0].id } }), 2);
  });

  test("each phone sees its own lines at the point; the POS sees the named takeaways and what's waiting", async () => {
    const mine = await guestOrderView(point.takeaway.token, P.id, true);
    assert.deepEqual(mine?.lines.map((l) => [l.name, l.quantity, l.stage]), [["PT Pepper soup", 2, "waiting"], ["PT Pepper soup", 1, "waiting"]]);
    assert.equal((await guestOrderView(point.takeaway.token, Q.id, true))?.lines.length, 1);
    const floor = await getFloor();
    const ada = floor.guestOrders.find((g) => g.label === "Takeaway · Ada");
    assert.deepEqual([ada?.tableId, ada?.lines, ada?.waiterIds], [null, 2, []]);
    const counter = await getCounterOrders();
    assert.deepEqual(counter.filter((c) => c.label.startsWith("Takeaway · ")).map((c) => [c.label, c.note]).filter(([l]) => l === "Takeaway · Ada" || l === "Takeaway · Obi"), [["Takeaway · Ada", "Pay at counter"], ["Takeaway · Obi", "Pay at counter"]]);
  });

  test("a waiter confirms a takeaway's lines like a table's", async () => {
    const [ada] = await pointOrders(point.takeaway.token);
    const lines = await guestLinesOf(ada.id);
    const confirmed = await confirmGuestLines(ada.id, (await prisma.order.findUniqueOrThrow({ where: { id: ada.id } })).version, lines.map((l) => l.id), waiter.id);
    assert.ok(confirmed.ok);
    assert.deepEqual((await prisma.orderItem.findMany({ where: { orderId: ada.id }, select: { kitchenStatus: true, unitPrice: true } })).map((i) => [i.kitchenStatus, i.unitPrice.toFixed(2)]), [["NEW", "2500.00"], ["NEW", "2500.00"]]);
  });

  test("a Bar point: a tab in the guest's name, Pay at the bar", async () => {
    assert.ok((await placeGuestOrder(point.bar.token, [soupLine()], P, at(), "Obi")).ok);
    const [tab] = await pointOrders(point.bar.token);
    assert.deepEqual([tab.type, tab.tabName, tab.notes, tab.source], ["BAR_TAB", "Obi", "Pay at the bar", "GUEST"]);
    assert.equal((await getCounterOrders()).find((c) => c.id === tab.id)?.label, "Tab · Obi");
    const barMenu = await loadPublicMenu(point.bar.token);
    assert.equal(barMenu.kind === "menu" ? barMenu.ordering?.where : null, "bar");
  });

  test("the code as a whole: at most 30 sends in 15 minutes", async () => {
    let refused = null;
    for (let i = 0; i < 31 && !refused; i++) {
      const result = await placeGuestOrder(point.bar.token, [soupLine()], phone(`flood${String(i).padStart(2, "0")}AAAAAAAAAAAAAAAA`), at(1_000), `Guest ${i}`);
      if (!result.ok) refused = result;
    }
    assert.deepEqual(refused, { ok: false, error: GUEST_ERRORS.tooMany, status: 429 });
  });
});

describe("Module off: no guest orders (database copy)", { skip }, () => {
  let was = true;
  before(async () => {
    was = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: false } });
  });
  after(async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: was } });
    await prisma.$disconnect();
  });

  test("the order route is a 404", async () => {
    assert.equal((await post(newQrToken(), { lines: [] })).status, 404);
  });
});
