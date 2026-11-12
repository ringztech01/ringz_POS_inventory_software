// The touch POS's order flow and till session against a real database
// (Part 6e Step 5): takeaways and bar tabs from the POS, the list of open
// ones, who can take over the till, one PIN per person (and its lock-out).
// Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/posSession.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { checkUserPin, findByPin, setApprovalPin } from "../server/services/approvalPins";
import { createCounterOrder, discardEmptyOrder, openTableCheck, openTableOrder } from "../server/services/floor";
import { getFloor } from "../server/queries/floor";
import { getBill } from "../server/queries/bill";
import { getCounterOrders, getPosStaff } from "../server/queries/posScreen";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let waiterId = "";
let cookId = "";

describe("Touch POS orders and till session (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const area = await prisma.diningArea.findFirst({ where: { deletedAt: null } });
    if (!area) {
      const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
      await prisma.diningArea.create({ data: { name: "Session check", warehouseId } });
    }
    // A waiter (Manage Orders only) and a cook (Kitchen Display only).
    const role = async (name: string, permission: string) =>
      (await prisma.role.create({ data: { name: `${name} ${Date.now()}`, permissions: { create: [{ permission }] } }, select: { id: true } })).id;
    const user = async (first: string, roleId: string) =>
      (
        await prisma.user.create({
          data: { firstName: first, lastName: "Check", email: `${first.toLowerCase()}-${Date.now()}@check.test`, password: await bcrypt.hash("x", 4), roleId },
          select: { id: true },
        })
      ).id;
    waiterId = await user("Wanda", await role("Session waiter", RESTAURANT_PERMISSIONS.MANAGE_ORDERS));
    cookId = await user("Cyril", await role("Session cook", RESTAURANT_PERMISSIONS.KITCHEN_DISPLAY));
  });
  after(() => prisma.$disconnect());

  test("Takeaway and Bar tab from the POS: no table, the waiter's, the restaurant's warehouse; a tab keeps its name", async () => {
    const takeaway = await createCounterOrder({ type: "TAKEAWAY" }, waiterId);
    const tab = await createCounterOrder({ type: "BAR_TAB", tabName: "Ada — blue shirt" }, waiterId);
    assert.ok(takeaway.ok && tab.ok);
    const rows = await prisma.order.findMany({ where: { id: { in: [takeaway.orderId, tab.orderId] } }, orderBy: { number: "asc" } });
    assert.deepEqual(rows.map((o) => [o.type, o.status, o.tableId, o.tabName, o.waiterId]), [["TAKEAWAY", "OPEN", null, null, waiterId], ["BAR_TAB", "OPEN", null, "Ada — blue shirt", waiterId]]);
    const setting = await prisma.businessSetting.findUnique({ where: { id: "default" } });
    if (setting?.restaurantWarehouseId) assert.equal(rows[0].warehouseId, setting.restaurantWarehouseId);
    // Where a table's name goes, a tab shows its own.
    assert.equal((await getBill(tab.orderId))!.order.table, "Tab · Ada — blue shirt");
    const open = await getCounterOrders();
    assert.ok(open.some((o) => o.id === tab.orderId && o.label === "Tab · Ada — blue shirt" && o.type === "BAR_TAB"));
    assert.ok(open.some((o) => o.id === takeaway.orderId && o.label === "Takeaway"));
  });

  test("one PIN per person: a waiter can set theirs; someone who neither takes orders nor approves can't", async () => {
    assert.ok((await setApprovalPin(waiterId, "2468")).ok);
    const refused = await setApprovalPin(cookId, "1357");
    assert.equal(!refused.ok && refused.error, "Only someone who takes orders or approves discounts or waste sets a PIN.");
    const { staff } = await getPosStaff();
    assert.ok(staff.some((s) => s.id === waiterId && s.name === "Wanda C."), "on the till's list once they have a PIN");
    assert.ok(!staff.some((s) => s.id === cookId));
  });

  test("the POS sign-in PIN check: right, wrong (counted), five wrong lock it", async () => {
    const check = (pin: string) => prisma.$transaction((tx) => checkUserPin(tx, waiterId, pin, "Wanda"));
    assert.deepEqual(await check("2468"), { ok: true });
    for (let i = 1; i <= 4; i++) assert.deepEqual(await check("0000"), { ok: false, error: "That PIN isn't right." });
    const locked = await check("0000");
    assert.equal(!locked.ok && locked.error, "That PIN isn't right. Too many tries — Wanda's PIN is locked for 5 minutes.");
    const even = await check("2468");
    assert.ok(!even.ok && even.error.startsWith("Too many wrong PINs. Wanda's PIN is locked for"), "locked: even the right one waits");
    assert.ok((await setApprovalPin(waiterId, "2468")).ok, "setting it again clears the lock");
    assert.deepEqual(await check("2468"), { ok: true });
  });

  test("an empty order left behind is thrown away and frees its table; one with lines, a tab or a sent ticket stays", async () => {
    const area = await prisma.diningArea.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const table = await prisma.table.create({ data: { name: `Empty ${Date.now()}`, seats: 2, areaId: area.id, qrToken: `empty-${Date.now()}` }, select: { id: true } });
    const product = await prisma.product.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const holding = () => prisma.order.count({ where: { activeTableId: table.id } });

    // Tapped by mistake, nothing added: gone, and the table is free again.
    const mistake = await openTableOrder(table.id, waiterId);
    assert.ok(mistake.ok);
    assert.equal(await holding(), 1, "a new order holds its table");
    assert.deepEqual(await discardEmptyOrder(mistake.orderId), { ok: true, discarded: true });
    assert.equal(await holding(), 0, "…and lets go of it once thrown away");
    assert.ok((await prisma.order.findUniqueOrThrow({ where: { id: mistake.orderId } })).deletedAt);
    assert.deepEqual(await discardEmptyOrder(mistake.orderId), { ok: true, discarded: false }, "twice: nothing more");

    // A dish added and taken off again: still empty.
    const again = await openTableOrder(table.id, waiterId);
    assert.ok(again.ok, "the table opens again");
    await prisma.orderItem.create({ data: { orderId: again.orderId, productId: product.id, quantity: 1, unitPrice: "10", deletedAt: new Date() } });
    assert.equal((await discardEmptyOrder(again.orderId)).discarded, true);

    // A line on it: kept.
    const real = await openTableOrder(table.id, waiterId);
    assert.ok(real.ok);
    await prisma.orderItem.create({ data: { orderId: real.orderId, productId: product.id, quantity: 1, unitPrice: "10" } });
    assert.equal((await discardEmptyOrder(real.orderId)).discarded, false);
    assert.equal(await holding(), 1);

    // A bar tab (opened by name before ordering): kept, even empty.
    const tab = await createCounterOrder({ type: "BAR_TAB", tabName: "Kept" }, waiterId);
    assert.ok(tab.ok);
    assert.equal((await discardEmptyOrder(tab.orderId)).discarded, false);
    // An empty takeaway: thrown away like a table's.
    const takeaway = await createCounterOrder({ type: "TAKEAWAY" }, waiterId);
    assert.ok(takeaway.ok);
    assert.equal((await discardEmptyOrder(takeaway.orderId)).discarded, true);
  });

  test("PIN-only sign-in (PIN Login design): the PIN finds its person; none is wrong; a shared PIN asks for the name", async () => {
    const twinRole = (await prisma.user.findUniqueOrThrow({ where: { id: waiterId }, select: { roleId: true } })).roleId;
    const twin = await prisma.user.create({ data: { firstName: "Tess", lastName: "Check", email: `tess-${Date.now()}@check.test`, password: await bcrypt.hash("x", 4), roleId: twinRole }, select: { id: true } });
    const only = { id: { in: [waiterId, twin.id] } };
    assert.ok((await setApprovalPin(waiterId, "5173")).ok);
    assert.ok((await setApprovalPin(twin.id, "9046")).ok);
    assert.deepEqual(await findByPin("5173", only), { kind: "one", user: { id: waiterId, firstName: "Wanda" } });
    assert.deepEqual(await findByPin("9046", only), { kind: "one", user: { id: twin.id, firstName: "Tess" } });
    assert.deepEqual(await findByPin("0000", only), { kind: "none" });
    assert.ok((await setApprovalPin(twin.id, "5173")).ok);
    assert.deepEqual(await findByPin("5173", only), { kind: "shared" }, "two people, one PIN: tap your name");
    // A locked PIN isn't tried.
    await prisma.approvalPin.update({ where: { userId: twin.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    assert.deepEqual(await findByPin("5173", only), { kind: "one", user: { id: waiterId, firstName: "Wanda" } });
  });

  test("separate checks at a shared table: each guest their own order, bill and total; the table stays taken until the last goes", async () => {
    const area = await prisma.diningArea.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const table = await prisma.table.create({ data: { name: `Shared ${Date.now()}`, seats: 8, areaId: area.id, qrToken: `shared-${Date.now()}` }, select: { id: true, name: true } });
    const product = await prisma.product.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    const line = (orderId: string, unitPrice: string) => prisma.orderItem.create({ data: { orderId, productId: product.id, quantity: 1, unitPrice, kitchenStatus: "SERVED" } });

    const first = await openTableOrder(table.id, waiterId, 1);
    assert.ok(first.ok);
    await line(first.orderId, "1000");
    // Open table on a busy table still lands on its order (one tap, as before) …
    const again = await openTableOrder(table.id, waiterId);
    assert.ok(!again.ok && again.orderId === first.orderId);
    // … New check adds the next guest's own order.
    const ada = await openTableCheck(table.id, waiterId, 1, "Ada");
    const third = await openTableCheck(table.id, waiterId, 1, null);
    assert.ok(ada.ok && third.ok);
    await line(ada.orderId, "2500");
    const rows = await prisma.order.findMany({ where: { tableId: table.id, deletedAt: null }, orderBy: { number: "asc" }, select: { checkNumber: true, checkName: true } });
    assert.deepEqual(rows, [{ checkNumber: 1, checkName: null }, { checkNumber: 2, checkName: "Ada" }, { checkNumber: 3, checkName: null }]);

    // Each bill is the guest's own, labelled with their check.
    const [bill1, billAda] = [await getBill(first.orderId), await getBill(ada.orderId)];
    assert.deepEqual([bill1!.order.table, billAda!.order.table], [table.name, `${table.name} · Ada`]);
    assert.deepEqual([bill1!.lines.length, billAda!.lines.length, (await getBill(third.orderId))!.lines.length], [1, 1, 0], "each bill has only its own lines");

    // The floor: one table, three checks (named, numbered), one total.
    const floor = await getFloor(area.id);
    const shared = floor.tables.find((t) => t.id === table.id)!;
    assert.equal(shared.status, "Occupied");
    assert.deepEqual(shared.checks.map((c) => c.check), ["Check 1", "Ada", "Check 3"]);
    assert.ok(floor.targets.filter((t) => t.id === table.id).length === 3, "Merge can pick each check");

    // An empty check left behind goes; the others keep the table.
    assert.equal((await discardEmptyOrder(third.orderId)).discarded, true);
    assert.equal(await prisma.order.count({ where: { activeTableId: table.id } }), 2);
    // The next new check takes the next number after the highest open one.
    const fourth = await openTableCheck(table.id, waiterId, 2, null);
    assert.ok(fourth.ok);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: fourth.orderId } })).checkNumber, 3);
  });
});
