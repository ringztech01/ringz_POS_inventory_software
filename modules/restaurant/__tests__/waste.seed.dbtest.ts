// The waste schema and its sample entries (modules/restaurant/seed.ts) on a
// freshly seeded throwaway copy — run by the seeded DB check after the seed:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/waste.seed.dbtest.ts
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// The seed's starting stock for the wasted items (INGREDIENTS / 40 for a dish
// with no recipe).
const STARTED: Record<string, number> = { Fanta: 48, "Goat meat": 10, "Spring Rolls": 40, "Chicken wings": 12, "Beef sirloin": 15 };

describe("Waste schema and seed (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  after(async () => {
    await prisma.$disconnect();
  });

  test("the sample entries: reasons, a note, the cost then, a voided one and its VOID entry", async () => {
    const entries = await prisma.wasteEntry.findMany({
      orderBy: { createdAt: "asc" },
      include: { product: { select: { name: true } }, lines: { include: { product: { select: { name: true } } } } },
    });
    assert.deepEqual(
      entries.map((e) => [e.product.name, e.qty.toString(), e.unit, e.reason, e.status, e.costSnapshot.toFixed(2), e.note, !!e.voidOfId, e.voidReason]),
      [
        ["Fanta", "2", "btl", "EXPIRED", "ACTIVE", "1.20", null, false, null],
        ["Goat meat", "1", "kg", "EXPIRED", "ACTIVE", "11.00", null, false, null],
        ["Spring Rolls", "4", "pc", "OVERPRODUCTION", "ACTIVE", "0.00", null, false, null],
        ["Chicken wings", "1", "kg", "OTHER", "ACTIVE", "6.00", "Freezer door left open overnight", false, null],
        ["Beef sirloin", "1", "kg", "BURNT", "VOID", "12.40", null, false, null],
        ["Beef sirloin", "1", "kg", "BURNT", "VOID", "12.40", null, true, "Logged on the wrong item"],
      ],
    );
    const [burnt, voiding] = entries.slice(4);
    assert.equal(voiding.voidOfId, burnt.id, "the VOID entry points at the one it reversed");
    assert.equal(burnt.version, 1, "voiding bumped the entry's version");
    assert.ok(entries.every((e) => e.businessId === "default" && e.lines.length === 1));
    assert.ok(entries.every((e) => e.lines[0].product.name === e.product.name && e.lines[0].lineCost.equals(e.costSnapshot)), "lines: the item itself (raw ingredients, a dish with no recipe)");
    const setting = await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" } });
    assert.ok(entries.every((e) => e.warehouseId === setting.restaurantWarehouseId), "out of the restaurant's warehouse");
  });

  test("each entry's stock change is its lines exactly; the voided one nets to nothing", async () => {
    const setting = await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" } });
    const entries = await prisma.wasteEntry.findMany({ include: { lines: { include: { product: { select: { name: true } } } } } });
    const out = new Map<string, number>();
    for (const entry of entries) {
      // An ACTIVE entry took its lines out; a voided entry and its VOID entry cancel.
      const sign = entry.status === "ACTIVE" ? 1 : entry.voidOfId ? -1 : 1;
      for (const line of entry.lines) out.set(line.product.name, (out.get(line.product.name) ?? 0) + sign * Number(line.qty));
    }
    for (const [name, started] of Object.entries(STARTED)) {
      const product = await prisma.product.findFirstOrThrow({ where: { name, deletedAt: null } });
      const stock = await prisma.productStock.findUniqueOrThrow({ where: { productId_warehouseId: { productId: product.id, warehouseId: setting.restaurantWarehouseId! } } });
      assert.equal(started - stock.quantity, out.get(name) ?? 0, name);
    }
    assert.equal(out.get("Beef sirloin"), 0);
  });

  test("the indexes the spec asks for", async () => {
    const rows = await prisma.$queryRaw<{ name: string; columns: string }[]>`
      SELECT INDEX_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'wasteentry'
      GROUP BY INDEX_NAME`;
    const columns = rows.map((r) => r.columns);
    for (const wanted of ["businessId,createdAt", "businessId,reason", "productId", "voidOfId"]) assert.ok(columns.includes(wanted), `${wanted} in ${columns.join(" | ")}`);
    assert.ok(rows.some((r) => r.columns === "voidOfId" && r.name.endsWith("_key")), "voidOfId unique: an entry is voided once");
  });
});
