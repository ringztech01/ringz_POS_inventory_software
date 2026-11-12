// The touch POS's speed tools against a real database (Part 6e Step 4):
// Qty first, seats and courses, Hold / Fire and Send by course, the kitchen
// ticket's place note. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/posSpeed.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { addLine, holdLines, placeLines } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { getOrderScreen } from "../server/queries/orderScreen";
import { testTable } from "./dbNames";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

let userId = "";
let areaId = "";
let tables = 0;
const dish: Record<"rice" | "soup" | "cake", string> = { rice: "", soup: "", cake: "" };

const versionOf = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { version: true } })).version;
async function newOrder() {
  tables += 1;
  const table = await prisma.table.create({ data: { name: testTable(`SP${tables}`), seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, userId);
  assert.ok(opened.ok);
  return opened.orderId;
}
const add = async (orderId: string, productId: string, extra: { quantity?: number; seat?: number | null; course?: "STARTER" | "MAIN" | "DESSERT" | null } = {}) =>
  addLine({ orderId, version: await versionOf(orderId), productId, modifierIds: [], note: null, ...extra });
const linesOf = (orderId: string) =>
  prisma.orderItem.findMany({ where: { orderId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, productId: true, quantity: true, seat: true, course: true, heldAt: true, kitchenStatus: true } });

describe("Touch POS speed tools (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    areaId = (await prisma.diningArea.create({ data: { name: "Speed check", warehouseId }, select: { id: true } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const categoryId = (await prisma.category.create({ data: { name: "Speed check" }, select: { id: true } })).id;
    const stationId = (await prisma.kitchenStation.findUniqueOrThrow({ where: { code: "KIT" } })).id;
    for (const key of ["rice", "soup", "cake"] as const) {
      const product = await prisma.product.create({
        data: { name: `SP ${key}`, code: `SP-${key}-${Date.now()}`, price: "10.00", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", stationId },
        select: { id: true },
      });
      await prisma.productStock.create({ data: { productId: product.id, warehouseId, quantity: 500 } });
      dish[key] = product.id;
    }
  });
  after(() => prisma.$disconnect());

  test("Qty first: several at once; the same again adds to the line; never past 99", async () => {
    const orderId = await newOrder();
    assert.ok((await add(orderId, dish.rice, { quantity: 3 })).ok);
    assert.ok((await add(orderId, dish.rice, { quantity: 2 })).ok);
    assert.deepEqual((await linesOf(orderId)).map((l) => l.quantity), [5]);
    const over = await add(orderId, dish.rice, { quantity: 95 });
    assert.equal(!over.ok && over.error, "SP rice would go past 99 on this line.");
  });

  test("seats and courses keep lines apart; placeLines sets them (a sent line keeps its course)", async () => {
    const orderId = await newOrder();
    await add(orderId, dish.rice);
    await add(orderId, dish.rice, { seat: 2 });
    await add(orderId, dish.rice, { seat: 2, course: "MAIN" });
    await add(orderId, dish.rice, { seat: 2, course: "MAIN" });
    assert.deepEqual((await linesOf(orderId)).map((l) => [l.quantity, l.seat, l.course]), [[1, null, null], [1, 2, null], [2, 2, "MAIN"]]);
    const [first] = await linesOf(orderId);
    assert.ok((await placeLines({ orderId, version: await versionOf(orderId), lineIds: [first.id], seat: 3, course: "STARTER" })).ok);
    assert.deepEqual((await linesOf(orderId))[0], { ...first, seat: 3, course: "STARTER" });
    assert.ok((await sendToKitchen(orderId, await versionOf(orderId), userId)).ok);
    const sentCourse = await placeLines({ orderId, version: await versionOf(orderId), lineIds: [first.id], course: "MAIN" });
    assert.equal(!sentCourse.ok && sentCourse.error, "A line that's been sent keeps its course.");
    assert.ok((await placeLines({ orderId, version: await versionOf(orderId), lineIds: [first.id], seat: 1 })).ok, "a sent line can move seat");
    const gone = await placeLines({ orderId, version: await versionOf(orderId), lineIds: ["nope"], seat: 1 });
    assert.equal(gone.ok, false);
  });

  test("Hold: Send leaves held lines; a dish for a held course is held too; Fire sends them", async () => {
    const orderId = await newOrder();
    await add(orderId, dish.soup, { course: "STARTER" });
    await add(orderId, dish.rice, { course: "MAIN", seat: 1 });
    await add(orderId, dish.rice, { course: "MAIN", seat: 2 });
    const mains = (await linesOf(orderId)).filter((l) => l.course === "MAIN").map((l) => l.id);
    assert.ok((await holdLines({ orderId, version: await versionOf(orderId), lineIds: mains, held: true })).ok);
    await add(orderId, dish.cake, { course: "MAIN" });
    const cake = (await linesOf(orderId)).find((l) => l.productId === dish.cake)!;
    assert.ok(cake.heldAt, "a new dish for the held course waits with it");
    assert.equal((await getOrderScreen(orderId))!.newCount, 1, "Send counts only what isn't held");

    const sent = await sendToKitchen(orderId, await versionOf(orderId), userId);
    assert.ok(sent.ok);
    assert.deepEqual((await linesOf(orderId)).map((l) => [l.course, l.kitchenStatus, !!l.heldAt]), [["STARTER", "PENDING", false], ["MAIN", "NEW", true], ["MAIN", "NEW", true], ["MAIN", "NEW", true]]);
    // Fire: the held course (its lines named) goes now and is no longer held.
    const held = (await linesOf(orderId)).filter((l) => l.heldAt).map((l) => l.id);
    const fired = await sendToKitchen(orderId, await versionOf(orderId), userId, held);
    assert.ok(fired.ok && fired.sent.reduce((n, s) => n + s.count, 0) === 3);
    assert.ok((await linesOf(orderId)).every((l) => l.kitchenStatus === "PENDING" && !l.heldAt));
    // Holding a sent line is refused.
    const refused = await holdLines({ orderId, version: await versionOf(orderId), lineIds: [held[0]], held: true });
    assert.equal(!refused.ok && refused.error, "Only lines that haven't been sent can be held.");
  });

  test("Send a course: only its lines; the kitchen ticket says the seat and course", async () => {
    const orderId = await newOrder();
    await add(orderId, dish.soup, { course: "STARTER", seat: 2 });
    await add(orderId, dish.rice, { course: "MAIN" });
    const starters = (await linesOf(orderId)).filter((l) => l.course === "STARTER").map((l) => l.id);
    const result = await sendToKitchen(orderId, await versionOf(orderId), userId, starters);
    assert.ok(result.ok);
    assert.deepEqual((await linesOf(orderId)).map((l) => l.kitchenStatus), ["PENDING", "NEW"]);
    const kot = await prisma.kotLine.findFirstOrThrow({ where: { orderItemId: starters[0] } });
    assert.equal(kot.note, "Seat 2 · Starter");
    // Released and sent with the rest later: a held line can be released.
    const main = (await linesOf(orderId))[1].id;
    assert.ok((await holdLines({ orderId, version: await versionOf(orderId), lineIds: [main], held: true })).ok);
    assert.ok((await holdLines({ orderId, version: await versionOf(orderId), lineIds: [main], held: false })).ok);
    assert.ok((await sendToKitchen(orderId, await versionOf(orderId), userId)).ok);
    assert.deepEqual((await linesOf(orderId)).map((l) => l.kitchenStatus), ["PENDING", "PENDING"]);
  });
});
