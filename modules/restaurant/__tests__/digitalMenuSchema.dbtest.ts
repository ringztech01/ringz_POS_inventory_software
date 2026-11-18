// Part 8 Step 1 against a real database (a throwaway copy, migrated): the
// digital menu's schema. The business has its menu settings with guest
// ordering off; every table still has its own server-made token (nothing
// rotated); QR points take a unique token like a table's; menu items have
// the new media fields with their defaults. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/digitalMenuSchema.dbtest.ts
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

describe("Digital menu schema (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  after(async () => {
    await prisma.qrPoint.deleteMany({ where: { name: { startsWith: "Step 1 check" } } });
    await prisma.$disconnect();
  });

  test("the business's menu settings: one row, guest ordering off, waiter confirms", async () => {
    const rows = await prisma.menuSettings.findMany();
    assert.equal(rows.length, 1);
    const s = rows[0];
    assert.equal(s.businessId, "default");
    assert.deepEqual([s.menuEnabled, s.autoSendGuestOrders, s.requireWaiterConfirm, s.showPrices, s.showSoldOut], [true, false, true, true, true]);
    // Guest ordering and the guest buttons are off until someone switches
    // them on — the columns' defaults (the business's own row may already
    // have them on: the user switched the buttons on, 17 Nov 2026).
    const defaults = await prisma.$queryRaw<{ name: string; value: string }[]>`
      SELECT COLUMN_NAME AS name, COLUMN_DEFAULT AS value FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'MenuSettings' AND COLUMN_NAME IN ('guestOrderingEnabled', 'callWaiterEnabled', 'requestBillEnabled') ORDER BY COLUMN_NAME`;
    assert.deepEqual(defaults.map((d) => [d.name, String(d.value)]), [["callWaiterEnabled", "0"], ["guestOrderingEnabled", "0"], ["requestBillEnabled", "0"]]);
    assert.deepEqual([s.currencyDisplay, s.accentColour, s.menuTitle, s.wifiName, s.wifiPassword], ["SYMBOL", "#0f7d6a", null, null, null]);
  });

  test("every table keeps its own token: 24 URL-safe characters (144 bits), all different, none rotated", async () => {
    const tables = await prisma.table.findMany({ select: { qrToken: true, qrRotatedAt: true } });
    assert.ok(tables.length > 0);
    assert.ok(tables.every((t) => /^[A-Za-z0-9_-]{24}$/.test(t.qrToken)), "made by newQrToken");
    assert.equal(new Set(tables.map((t) => t.qrToken)).size, tables.length);
    assert.ok(tables.every((t) => t.qrRotatedAt === null));
  });

  test("a QR point: its own token, unique across points (a reused one is refused)", async () => {
    const token = newQrToken();
    const point = await prisma.qrPoint.create({ data: { name: "Step 1 check counter", qrToken: token, orderType: "TAKEAWAY" } });
    assert.deepEqual([point.businessId, point.orderType, point.deletedAt, point.qrRotatedAt], ["default", "TAKEAWAY", null, null]);
    await assert.rejects(
      prisma.qrPoint.create({ data: { name: "Step 1 check bar", qrToken: token, orderType: "BAR_TAB" } }),
      (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );
  });

  test("menu items: photoPath (was menuImage) and the media fields, with their defaults", async () => {
    const item = await prisma.product.findFirstOrThrow({
      where: { productType: "MENU_ITEM" },
      select: { photoPath: true, spinFrames: true, modelGlbPath: true, modelUsdzPath: true, mediaType: true, allergens: true, calories: true, isSignature: true, menuDescription: true },
    });
    assert.deepEqual([item.mediaType, item.isSignature, item.spinFrames, item.modelGlbPath, item.modelUsdzPath, item.allergens, item.calories], ["PHOTO", false, null, null, null, null, null]);
    const [column] = await prisma.$queryRaw<{ type: string }[]>`SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Product' AND COLUMN_NAME = 'menuDescription'`;
    assert.equal(column.type, "varchar(300)");
  });
});
