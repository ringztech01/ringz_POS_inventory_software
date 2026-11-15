import "server-only";
import { Prisma, type WasteReason } from "@prisma/client";
import { prisma } from "@/lib/db";
import { BUSINESS_SETTINGS_ID } from "@/lib/business-settings";
import { appZoneOffsetMinutes } from "../../../lib/time";
import type { ReportPeriod } from "./filters";
import { closedIn, ORDER_SALE, orderScopeSql, type ReportResult } from "./scope";

// Restaurant Reports › Waste (Step 7): the period's ACTIVE waste entries
// (voided ones and their reversals left out), added up in the database.
// Waste isn't tied to an order, so the report's order filters don't narrow
// it. Read-only.
//
//   by ingredient  the entries' stock lines (WasteEntryLine): a dish wasted
//                  is its ingredients, as they came out of stock
//   remakes        Kitchen Display › Remake (Part 6b): the free remake lines
//                  made in the period, and the waste logged with them (the
//                  spoilt dish — the entry for that line, made in the same
//                  moment as the remake)
//   food cost      the period's sold lines at their cost at settle, for
//                  waste as a share of it (View Cost only)

export type WasteGroup = { key: string; count: number; quantity: Prisma.Decimal; cost: Prisma.Decimal };

export type WasteData = {
  byReason: { reason: WasteReason; count: number; cost: Prisma.Decimal }[];
  byItem: (WasteGroup & { name: string; unit: string })[];
  byIngredient: (WasteGroup & { name: string; unit: string })[];
  byUser: (WasteGroup & { name: string })[];
  byDay: { day: string; cost: Prisma.Decimal }[];
  remakes: { productId: string; name: string; lines: number; quantity: number; cost: Prisma.Decimal }[];
  remakeCost: Prisma.Decimal;
  remakeEntries: number;
  foodCost: Prisma.Decimal | null;
  thresholds: { amber: Prisma.Decimal; red: Prisma.Decimal };
};

const ZERO = new Prisma.Decimal(0);
const dec = (value: unknown) => (value === null || value === undefined ? ZERO : new Prisma.Decimal(String(value)));
const int = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

const inPeriod = (p: ReportPeriod) =>
  Prisma.sql`w.businessId = ${BUSINESS_SETTINGS_ID} AND w.status = 'ACTIVE' AND w.deletedAt IS NULL AND w.createdAt >= ${p.start} AND w.createdAt < ${p.end}`;

// The waste a remake logged: on a line, with a remake of that dish made
// within a minute of it (the same transaction).
const IS_REMAKE = Prisma.sql`w.orderItemId IS NOT NULL AND EXISTS (
  SELECT 1 FROM OrderItem l JOIN OrderItem r ON r.remakeOfId = COALESCE(l.remakeOfId, l.id)
  WHERE l.id = w.orderItemId AND r.createdAt >= w.createdAt - INTERVAL 5 SECOND AND r.createdAt <= w.createdAt + INTERVAL 60 SECOND)`;

export async function getWasteReport(period: ReportPeriod, options: { dayStartMinutes: number; withCost: boolean }): Promise<ReportResult<WasteData>> {
  try {
    const dayShift = appZoneOffsetMinutes(period.start) - options.dayStartMinutes;
    const [byReason, byItem, byIngredient, byUser, byDay, remakeLines, remakeWaste, foodCost, settings] = await Promise.all([
      prisma.$queryRaw<{ reason: WasteReason; count: unknown; cost: unknown }[]>`
        SELECT w.reason AS reason, COUNT(*) AS count, COALESCE(SUM(w.costSnapshot), 0) AS cost
        FROM WasteEntry w WHERE ${inPeriod(period)} GROUP BY w.reason`,
      prisma.$queryRaw<{ key: string; count: unknown; quantity: unknown; cost: unknown; unit: string | null }[]>`
        SELECT w.productId AS \`key\`, COUNT(*) AS count, COALESCE(SUM(w.qty), 0) AS quantity, COALESCE(SUM(w.costSnapshot), 0) AS cost, MAX(w.unit) AS unit
        FROM WasteEntry w WHERE ${inPeriod(period)} GROUP BY w.productId`,
      prisma.$queryRaw<{ key: string; count: unknown; quantity: unknown; cost: unknown }[]>`
        SELECT l.productId AS \`key\`, COUNT(DISTINCT w.id) AS count, COALESCE(SUM(l.qty), 0) AS quantity, COALESCE(SUM(l.lineCost), 0) AS cost
        FROM WasteEntryLine l JOIN WasteEntry w ON w.id = l.entryId
        WHERE ${inPeriod(period)} GROUP BY l.productId`,
      prisma.$queryRaw<{ key: string; count: unknown; cost: unknown }[]>`
        SELECT w.loggedById AS \`key\`, COUNT(*) AS count, COALESCE(SUM(w.costSnapshot), 0) AS cost
        FROM WasteEntry w WHERE ${inPeriod(period)} GROUP BY w.loggedById`,
      prisma.$queryRaw<{ day: string; cost: unknown }[]>`
        SELECT DATE_FORMAT(DATE_ADD(w.createdAt, INTERVAL ${dayShift} MINUTE), '%Y-%m-%d') AS day, COALESCE(SUM(w.costSnapshot), 0) AS cost
        FROM WasteEntry w WHERE ${inPeriod(period)} GROUP BY day`,
      prisma.$queryRaw<{ productId: string; lineCount: unknown; quantity: unknown }[]>`
        SELECT r.productId AS productId, COUNT(*) AS lineCount, COALESCE(SUM(r.quantity), 0) AS quantity
        FROM OrderItem r JOIN \`Order\` o ON o.id = r.orderId
        WHERE r.remakeOfId IS NOT NULL AND r.deletedAt IS NULL AND r.createdAt >= ${period.start} AND r.createdAt < ${period.end}
          AND o.deletedAt IS NULL AND o.training = 0
        GROUP BY r.productId`,
      prisma.$queryRaw<{ productId: string; count: unknown; cost: unknown }[]>`
        SELECT w.productId AS productId, COUNT(*) AS count, COALESCE(SUM(w.costSnapshot), 0) AS cost
        FROM WasteEntry w WHERE ${inPeriod(period)} AND ${IS_REMAKE} GROUP BY w.productId`,
      options.withCost
        ? prisma.$queryRaw<{ cost: unknown }[]>`
            SELECT COALESCE(SUM(i.quantity * i.unitCost), 0) AS cost
            FROM OrderItem i JOIN ${ORDER_SALE} ON o.id = i.orderId
            WHERE i.deletedAt IS NULL AND i.cancelledAt IS NULL AND i.kitchenStatus <> 'NEW' AND i.remakeOfId IS NULL
              AND ${orderScopeSql({ area: null, waiter: null, type: null, station: null, device: null })} AND ${closedIn(period)}`
        : Promise.resolve(null),
      prisma.businessSetting.findUnique({ where: { id: BUSINESS_SETTINGS_ID }, select: { restaurantWasteAmberPercent: true, restaurantWasteRedPercent: true } }),
    ]);

    const productIds = [...new Set([...byItem.map((r) => r.key), ...byIngredient.map((r) => r.key), ...remakeLines.map((r) => r.productId), ...remakeWaste.map((r) => r.productId)])];
    const userIds = byUser.map((r) => r.key);
    const [products, users] = await Promise.all([
      productIds.length ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, unit: { select: { name: true } } } }) : Promise.resolve([]),
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, firstName: true, lastName: true } }) : Promise.resolve([]),
    ]);
    const product = new Map(products.map((p) => [p.id, p]));
    const userName = new Map(users.map((u) => [u.id, u.displayName || `${u.firstName} ${u.lastName}`.trim()]));
    const remakeCostBy = new Map(remakeWaste.map((r) => [r.productId, dec(r.cost)]));

    return {
      ok: true,
      data: {
        byReason: byReason.map((r) => ({ reason: r.reason, count: int(r.count), cost: dec(r.cost) })),
        byItem: byItem.map((r) => ({ key: r.key, name: product.get(r.key)?.name ?? "Deleted item", unit: r.unit ?? product.get(r.key)?.unit.name ?? "", count: int(r.count), quantity: dec(r.quantity), cost: dec(r.cost) })),
        byIngredient: byIngredient.map((r) => ({ key: r.key, name: product.get(r.key)?.name ?? "Deleted item", unit: product.get(r.key)?.unit.name ?? "", count: int(r.count), quantity: dec(r.quantity), cost: dec(r.cost) })),
        byUser: byUser.map((r) => ({ key: r.key, name: userName.get(r.key) ?? "Deleted user", count: int(r.count), quantity: ZERO, cost: dec(r.cost) })),
        byDay: byDay.map((r) => ({ day: r.day, cost: dec(r.cost) })),
        remakes: [...new Set([...remakeLines.map((r) => r.productId), ...remakeWaste.map((r) => r.productId)])].map((id) => {
          const line = remakeLines.find((r) => r.productId === id);
          return { productId: id, name: product.get(id)?.name ?? "Deleted item", lines: int(line?.lineCount), quantity: int(line?.quantity), cost: remakeCostBy.get(id) ?? ZERO };
        }),
        remakeCost: remakeWaste.reduce((t, r) => t.plus(dec(r.cost)), ZERO),
        remakeEntries: remakeWaste.reduce((n, r) => n + int(r.count), 0),
        foodCost: foodCost ? dec(foodCost[0]?.cost) : null,
        thresholds: { amber: settings?.restaurantWasteAmberPercent ?? new Prisma.Decimal(5), red: settings?.restaurantWasteRedPercent ?? new Prisma.Decimal(10) },
      },
    };
  } catch (error) {
    console.error("[restaurant] reports: waste failed:", error);
    return { ok: false, error: "The waste report couldn't be loaded. Please try again." };
  }
}
