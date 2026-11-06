// The restaurant demo seed (modules/restaurant/demoSeed.ts) on a throwaway
// copy: it runs, everything it makes is usable — a bill with recipe dishes
// settles (whole-unit recipes, enough stock) — a second run adds nothing,
// and --remove takes it out again. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/demoSeed.dbtest.ts
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { openTableOrder } from "../server/services/floor";
import { addLine } from "../server/services/orderLines";
import { sendToKitchen } from "../server/services/orderFlow";
import { settleOrder } from "../server/services/settle";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const runSeed = (...args: string[]) =>
  spawnSync("npx", ["tsx", "--tsconfig", "modules/restaurant/__tests__/tsconfig.dbtest.json", "modules/restaurant/demoSeed.ts", ...args], { env: process.env, shell: true, encoding: "utf8" });
const version = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id } })).version;
const counts = async () => ({
  products: await prisma.product.count({ where: { deletedAt: null, OR: [{ code: { startsWith: "DM-" } }, { code: { startsWith: "DI-" } }] } }),
  tables: await prisma.table.count({ where: { deletedAt: null, area: { name: { in: ["Garden Terrace", "VIP Lounge", "Bar Counter"] } } } }),
  staff: await prisma.user.count({ where: { deletedAt: null, email: { endsWith: "@demo.test" } } }),
  adjustments: await prisma.adjustment.count({ where: { notes: { startsWith: "Restaurant demo" } } }),
  openDemoOrders: await prisma.order.count({ where: { status: { notIn: ["BILLED", "CANCELLED"] }, table: { area: { name: { in: ["Garden Terrace", "VIP Lounge", "Bar Counter"] } } } } }),
});

describe("Restaurant demo seed (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  after(() => prisma.$disconnect());

  test("seeds the menu, stock, floor, staff, busy tables and bookings", async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: true } });
    const run = runSeed();
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.deepEqual(await counts(), { products: 35 + 49, tables: 13, staff: 4, adjustments: 1, openDemoOrders: 4 });
    const setting = await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" } });
    const rice = await prisma.product.findUniqueOrThrow({ where: { code: "DI-01" } });
    assert.equal((await prisma.productStock.findFirstOrThrow({ where: { productId: rice.id, warehouseId: setting.restaurantWarehouseId! } })).quantity, 60000);
    // Every recipe in whole units (settle refuses part units).
    const lines = await prisma.recipeLine.findMany({ where: { menuItem: { code: { startsWith: "DM-" } } } });
    assert.ok(lines.length > 50 && lines.every((l) => l.quantity.isInteger()), "whole-unit recipes");
    // The busy tables, through the real flow: tickets on the kitchen display.
    const orders = await prisma.order.findMany({ where: { table: { name: { in: ["G1", "G3", "V1", "BC2"] } }, status: { notIn: ["CANCELLED", "BILLED"] } }, include: { table: true, items: true, kots: true } });
    const by = Object.fromEntries(orders.map((o) => [o.table!.name, o]));
    assert.equal(by.G1.kots.length, 0, "G1 not sent yet");
    assert.ok(by.G3.kots.length === 2 && by.V1.kots.length === 2, "kitchen + bar tickets");
    assert.ok(by.BC2.items.every((i) => i.kitchenStatus === "SERVED"), "BC2 served");
    const cashier = await prisma.user.findFirstOrThrow({ where: { email: "cashier@demo.test" }, include: { userRole: { include: { permissions: true } } } });
    assert.ok(cashier.userRole!.permissions.some((p) => p.permission === "Settle Bill"));
  });

  test("a bill with recipe dishes settles — whole units, enough stock; the served table pays too", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true } } });
    const table = await prisma.table.findFirstOrThrow({ where: { name: "G5", deletedAt: null } });
    const opened = await openTableOrder(table.id, admin.id);
    assert.ok(opened.ok);
    const id = (code: string) => prisma.product.findUniqueOrThrow({ where: { code } }).then((p) => p.id);
    const choice = (group: string, name: string) => prisma.modifier.findFirstOrThrow({ where: { name, group: { name: group, deletedAt: null }, deletedAt: null } }).then((m) => m.id);
    for (const [code, mods] of [["DM-201", [["Swallow", "Eba"], ["Choice of protein", "Beef"]]], ["DM-301", [["Portion size", "Large"]]], ["DM-405", [["Spice level", "Mild"]]], ["DM-801", []], ["DM-951", []], ["DM-902", [["Serve", "Chilled"]]]] as const) {
      const modifierIds = await Promise.all(mods.map(([g, n]) => choice(g, n)));
      const added = await addLine({ orderId: opened.orderId, version: await version(opened.orderId), productId: await id(code), modifierIds, note: null });
      assert.ok(added.ok, `${code}: ${JSON.stringify(added)}`);
    }
    assert.ok((await sendToKitchen(opened.orderId, await version(opened.orderId), admin.id)).ok);
    const egusiBefore = await prisma.productStock.findFirstOrThrow({ where: { product: { code: "DI-12" } } });
    const settled = await settleOrder({ orderId: opened.orderId, version: await version(opened.orderId), payments: [{ paymentType: "CASH", amount: "100000" }], tip: "0", idempotencyKey: randomUUID() }, admin.id);
    assert.ok(settled.ok, JSON.stringify(settled));
    const egusiAfter = await prisma.productStock.findUniqueOrThrow({ where: { id: egusiBefore.id } });
    assert.equal(egusiBefore.quantity - egusiAfter.quantity, 80, "80 g of egusi used");
    const bc2 = await prisma.order.findFirstOrThrow({ where: { table: { name: "BC2" }, status: { notIn: ["CANCELLED", "BILLED"] } } });
    const paid = await settleOrder({ orderId: bc2.id, version: bc2.version, payments: [{ paymentType: "CARD", amount: "14300" }], tip: "0", idempotencyKey: randomUUID() }, admin.id);
    assert.ok(paid.ok, JSON.stringify(paid));
  });

  test("a second run adds nothing", async () => {
    const before = await counts();
    const run = runSeed();
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.deepEqual(await counts(), before);
  });

  test("--remove takes the demo out (sales kept)", async () => {
    const sales = await prisma.sale.count();
    const run = runSeed("--remove");
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.deepEqual(await counts(), { products: 0, tables: 0, staff: 0, adjustments: 1, openDemoOrders: 0 });
    assert.equal(await prisma.sale.count(), sales, "the sales made stay");
  });
});
