// Part 8 Step 6 against a real database (a throwaway copy): service
// requests. Its own area and tables, then the guest's side (the request and
// status routes, the menu) and the waiter's (the floor, a tap on the bell):
//   - off until switched on; a table's token only (not a QR point's, a
//     rotated or made-up one);
//   - one active request of each type per table, one new one a minute, and
//     two phones at once get one request, not two;
//   - on the floor with the table's waiter; a tap acknowledges, the next
//     says done; a tap that crossed another's is refused;
//   - what the guest gets back: states only, never a staff name;
//   - module off: 404.
// Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/tableRequests.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { loadPublicMenu } from "../server/queries/publicMenu";
import { getFloor } from "../server/queries/floor";
import { openTableOrder } from "../server/services/floor";
import { replaceQrToken } from "../server/services/tables";
import { createGuestRequest, guestServiceState, REQUEST_ERRORS, saveServiceButtons, tapTableRequest } from "../server/services/tableRequests";
import { POST as requestRoute } from "../server/routes/menuRequest";
import { GET as statusRoute } from "../server/routes/menuStatus";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const skip = enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database";

let areaId = "";
const table = { a: { id: "", token: "" }, b: { id: "", token: "" }, c: { id: "", token: "" } };
let pointToken = "";
let waiter = { id: "", firstName: "" };
let other = { id: "", firstName: "" };
let settingsId = "";
const was = { callWaiter: false, requestBill: false, module: true };

const post = (token: string, body: unknown, headers: Record<string, string> = {}) =>
  requestRoute(new Request(`http://192.168.1.20:3000/menu/${token}/request`, { method: "POST", headers: { host: "192.168.1.20:3000", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), { params: Promise.resolve({ qrToken: token }) });
const status = (token: string) => statusRoute(new Request(`http://localhost/menu/${token}/status`), { params: Promise.resolve({ qrToken: token }) });
const later = (ms: number) => new Date(Date.now() + ms);

describe("Service requests (database copy)", { skip }, () => {
  before(async () => {
    was.module = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: true } });
    const s = await prisma.menuSettings.findFirstOrThrow();
    settingsId = s.id;
    Object.assign(was, { callWaiter: s.callWaiterEnabled, requestBill: s.requestBillEnabled });
    await prisma.menuSettings.update({ where: { id: s.id }, data: { callWaiterEnabled: false, requestBillEnabled: false, menuEnabled: true } });
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Requests check", warehouseId }, select: { id: true } })).id;
    for (const key of ["a", "b", "c"] as const) {
      table[key].token = newQrToken();
      table[key].id = (await prisma.table.create({ data: { name: `RQ${key}${Date.now() % 100000}`, seats: 2, areaId, qrToken: table[key].token }, select: { id: true } })).id;
    }
    pointToken = newQrToken();
    await prisma.qrPoint.create({ data: { name: "RQ counter", qrToken: pointToken, orderType: "TAKEAWAY" } });
    const people = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, firstName: true }, take: 2, orderBy: { createdAt: "asc" } });
    [waiter, other] = [people[0], people[1] ?? people[0]];
  });

  after(async () => {
    const tableIds = Object.values(table).map((t) => t.id);
    await prisma.tableRequest.deleteMany({ where: { tableId: { in: tableIds } } });
    const orders = await prisma.order.findMany({ where: { tableId: { in: tableIds } }, select: { id: true } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
    await prisma.table.deleteMany({ where: { id: { in: tableIds } } });
    await prisma.diningArea.delete({ where: { id: areaId } });
    await prisma.qrPoint.deleteMany({ where: { qrToken: pointToken } });
    await prisma.auditLog.deleteMany({ where: { action: "menu.service.update", entityId: settingsId, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    await prisma.menuSettings.update({ where: { id: settingsId }, data: { callWaiterEnabled: was.callWaiter, requestBillEnabled: was.requestBill } });
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: was.module } });
  });

  test("off until switched on: no buttons, and a request is refused", async () => {
    assert.equal(await guestServiceState(table.a.token), null);
    const page = await loadPublicMenu(table.a.token);
    assert.equal(page.kind === "menu" && page.service, null);
    const refused = await createGuestRequest(table.a.token, "CALL_WAITER");
    assert.deepEqual(refused, { ok: false, error: REQUEST_ERRORS.off, status: 403 });
    assert.equal(await prisma.tableRequest.count({ where: { tableId: table.a.id } }), 0);
  });

  test("switching them on (logged); only Call waiter shows when Request bill is off", async () => {
    await saveServiceButtons({ callWaiter: true, requestBill: false }, waiter.id);
    assert.deepEqual((await guestServiceState(table.a.token))?.buttons, { callWaiter: true, requestBill: false });
    assert.equal((await createGuestRequest(table.a.token, "REQUEST_BILL")).ok, false);
    await saveServiceButtons({ callWaiter: true, requestBill: true }, waiter.id);
    const logged = await prisma.auditLog.findFirst({ where: { action: "menu.service.update", entityId: settingsId }, orderBy: { createdAt: "desc" } });
    assert.ok(logged);
    const page = await loadPublicMenu(table.a.token);
    assert.ok(page.kind === "menu" && page.service);
    assert.deepEqual(page.kind === "menu" && page.service, { buttons: { callWaiter: true, requestBill: true }, requests: { CALL_WAITER: null, REQUEST_BILL: null } });
  });

  test("a table's code only: not a QR point's, nor a made-up one", async () => {
    assert.equal(await guestServiceState(pointToken), null);
    const page = await loadPublicMenu(pointToken);
    assert.equal(page.kind === "menu" && page.service, null, "a QR point's menu has no buttons");
    assert.deepEqual(await createGuestRequest(pointToken, "CALL_WAITER"), { ok: false, error: REQUEST_ERRORS.gone, status: 404 });
    assert.deepEqual(await createGuestRequest("AAAAAAAAAAAAAAAAAAAAAAAA", "CALL_WAITER"), { ok: false, error: REQUEST_ERRORS.gone, status: 404 });
    assert.equal((await post("not-a-token", { type: "CALL_WAITER" })).status, 404);
  });

  test("one of each type per table, one new request a minute", async () => {
    const first = await createGuestRequest(table.a.token, "CALL_WAITER");
    assert.deepEqual(first, { ok: true, requests: { CALL_WAITER: "open", REQUEST_BILL: null } });
    assert.deepEqual(await createGuestRequest(table.a.token, "CALL_WAITER", later(5 * 60_000)), { ok: false, error: REQUEST_ERRORS.already.CALL_WAITER, status: 429 });
    assert.deepEqual(await createGuestRequest(table.a.token, "REQUEST_BILL"), { ok: false, error: REQUEST_ERRORS.tooSoon, status: 429 });
    const bill = await createGuestRequest(table.a.token, "REQUEST_BILL", later(61_000));
    assert.deepEqual(bill, { ok: true, requests: { CALL_WAITER: "open", REQUEST_BILL: "open" } });
    assert.equal(await prisma.tableRequest.count({ where: { tableId: table.a.id } }), 2);
    assert.equal((await createGuestRequest(table.b.token, "CALL_WAITER")).ok, true, "another table isn't held up");
  });

  test("two phones at the same moment: one request, not two", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => createGuestRequest(table.c.token, "CALL_WAITER")));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(await prisma.tableRequest.count({ where: { tableId: table.c.id } }), 1);
  });

  test("on the floor: every area's requests, with the table's waiter", async () => {
    const opened = await openTableOrder(table.a.id, waiter.id, 2);
    assert.ok(opened.ok);
    const floor = await getFloor(areaId);
    const mine = floor.requests.filter((r) => r.areaId === areaId);
    assert.deepEqual(mine.map((r) => [r.tableId, r.type, r.status]).sort(), [
      [table.a.id, "CALL_WAITER", "OPEN"],
      [table.a.id, "REQUEST_BILL", "OPEN"],
      [table.b.id, "CALL_WAITER", "OPEN"],
      [table.c.id, "CALL_WAITER", "OPEN"],
    ].sort());
    assert.deepEqual(mine.find((r) => r.tableId === table.a.id)?.waiterIds, [waiter.id]);
    assert.deepEqual(mine.find((r) => r.tableId === table.b.id)?.waiterIds, [], "a free table's request is everyone's");
    // Seen from another area too (the toast reaches the waiter there).
    const elsewhere = await getFloor("no-such-area");
    assert.ok(elsewhere.requests.some((r) => r.tableId === table.a.id));
  });

  test("a tap acknowledges, the next says done; a crossed tap is refused", async () => {
    const call = await prisma.tableRequest.findFirstOrThrow({ where: { tableId: table.a.id, type: "CALL_WAITER" } });
    assert.equal((await tapTableRequest(call.id, "ACKNOWLEDGED", waiter.id)).ok, false, "the screen was out of date");
    assert.deepEqual(await tapTableRequest(call.id, "OPEN", waiter.id), { ok: true, status: "ACKNOWLEDGED" });
    const acked = await prisma.tableRequest.findUniqueOrThrow({ where: { id: call.id } });
    assert.equal(acked.ackById, waiter.id);
    assert.ok(acked.ackAt);
    // Another waiter's tap that crossed it.
    assert.deepEqual(await tapTableRequest(call.id, "OPEN", other.id), { ok: false, error: `${waiter.firstName} is already on it.` });
    assert.deepEqual((await guestServiceState(table.a.token))?.requests, { CALL_WAITER: "acknowledged", REQUEST_BILL: "open" });
    // Still one at a time while a waiter's on the way.
    assert.equal((await createGuestRequest(table.a.token, "CALL_WAITER", later(2 * 60_000))).ok, false);
    assert.deepEqual(await tapTableRequest(call.id, "ACKNOWLEDGED", waiter.id), { ok: true, status: "DONE" });
    assert.equal((await tapTableRequest(call.id, "ACKNOWLEDGED", waiter.id)).ok, false, "done is done");
    assert.ok(!(await getFloor(areaId)).requests.some((r) => r.id === call.id));
    assert.deepEqual((await guestServiceState(table.a.token))?.requests, { CALL_WAITER: null, REQUEST_BILL: "open" });
    // (A minute after the table's last request — the bill, at +61 s.)
    assert.equal((await createGuestRequest(table.a.token, "CALL_WAITER", later(3 * 60_000))).ok, true, "and the guest can call again");
  });

  test("the guest's routes: states only, never who; another site's form is refused", async () => {
    const live = await status(table.a.token);
    assert.equal(live.status, 200);
    const body = (await live.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["order", "requests", "statuses"]);
    assert.deepEqual(body.requests, { CALL_WAITER: "open", REQUEST_BILL: "open" });
    const text = JSON.stringify(body);
    for (const leak of [waiter.id, table.a.id, "ackBy", "waiter"]) assert.ok(!text.includes(leak), `no ${leak}`);
    assert.equal(((await (await status(pointToken)).json()) as { requests: unknown }).requests, null);

    assert.equal((await post(table.b.token, { type: "CALL_WAITER" }, { origin: "http://evil.example" })).status, 403);
    assert.equal((await post(table.b.token, "{not json")).status, 400);
    assert.equal((await post(table.b.token, { type: "PAY_NOW" })).status, 400);
    const again = await post(table.b.token, { type: "CALL_WAITER" }, { origin: "http://192.168.1.20:3000" });
    assert.equal(again.status, 429);
    assert.deepEqual(await again.json(), { ok: false, error: REQUEST_ERRORS.already.CALL_WAITER });
    await prisma.tableRequest.updateMany({ where: { tableId: table.b.id }, data: { status: "DONE", createdAt: new Date(Date.now() - 120_000) } });
    const ok = await post(table.b.token, { type: "REQUEST_BILL" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, requests: { CALL_WAITER: null, REQUEST_BILL: "open" } });
  });

  test("a rotated code stops working for requests too", async () => {
    assert.ok(await replaceQrToken(table.c.id));
    assert.deepEqual(await createGuestRequest(table.c.token, "REQUEST_BILL", later(5 * 60_000)), { ok: false, error: REQUEST_ERRORS.gone, status: 404 });
    assert.equal(await guestServiceState(table.c.token), null);
  });

  test("a deleted table's requests leave the floor", async () => {
    await prisma.table.update({ where: { id: table.c.id }, data: { deletedAt: new Date() } });
    assert.ok(!(await getFloor(areaId)).requests.some((r) => r.tableId === table.c.id));
  });
});

describe("Module off: no guest requests (database copy)", { skip }, () => {
  let moduleWas = true;
  before(async () => {
    moduleWas = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: false } });
  });
  after(async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: moduleWas } });
    await prisma.$disconnect();
  });

  test("the request and status routes are 404s", async () => {
    assert.equal((await post(newQrToken(), { type: "CALL_WAITER" })).status, 404);
    assert.equal((await status(newQrToken())).status, 404);
  });
});
