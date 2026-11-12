// Part 7 Step 7 against a real database (a throwaway copy): with the
// Restaurant module switched off, the floor plan editor doesn't exist — its
// page and the module's pages are a 404, its routes answer 404, and every
// one of its actions is refused before it reads anything (no sign-in is
// even looked at), with nothing written. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/floorAccess.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { guardFloorPlanPage, guardPage, guardRoute, requireRestaurant } from "../server/guard";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import {
  adjustFloorBackground,
  deleteFloorPlanLayout,
  getFloorReach,
  removeFloorBackground,
  saveFloorPlan,
  saveFloorPlanLayout,
  setFloorPlanLock,
  switchFloorPlanLayout,
  uploadFloorBackground,
} from "../server/actions/floorPlan";
import { GET as floorImage } from "../server/routes/floorImage";
import { GET as tableQr } from "../server/routes/tableQr";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const is404 = (error: unknown) => (error as { digest?: string } | null)?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";
const OFF = "The Restaurant module is turned off.";
let was = true;
let areaId = "";

describe("Module off: the floor plan editor doesn't exist (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    was = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: false } });
    areaId = (await prisma.diningArea.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
  });
  after(async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: was } });
    await prisma.$disconnect();
  });

  test("the pages: a 404 (the editor's own guard, the module's pages, the layout's check)", async () => {
    for (const [name, run] of [
      ["requireRestaurant (every /restaurant/* layout and page)", () => requireRestaurant()],
      ["the floor plan editor", () => guardFloorPlanPage()],
      ["a restaurant page (Manage Tables)", () => guardPage(RESTAURANT_PERMISSIONS.MANAGE_TABLES)],
    ] as const) {
      await assert.rejects(run(), (error) => is404(error), name);
    }
  });

  test("the route handlers: 404 (the floor plan image, the table QR)", async () => {
    const response = await guardRoute(RESTAURANT_PERMISSIONS.MANAGE_FLOOR_PLAN);
    assert.equal(response?.status, 404);
    const params = (key: string) => ({ params: Promise.resolve({ [key]: areaId }) }) as never;
    assert.equal((await floorImage(new Request("http://x/") as never, params("areaId"))).status, 404);
    assert.equal((await tableQr(new Request("http://x/") as never, params("id"))).status, 404);
  });

  test("every floor plan action: refused, nothing written", async () => {
    const before = await prisma.diningArea.findUniqueOrThrow({ where: { id: areaId }, select: { layoutVersion: true, isLocked: true, backgroundImage: true, updatedAt: true } });
    const layouts = await prisma.floorLayout.count();
    const audit = await prisma.auditLog.count();
    const form = new FormData();
    form.set("areaId", areaId);
    form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "x.png", { type: "image/png" }));
    const results = {
      saveFloorPlan: await saveFloorPlan({ areas: [{ areaId, layoutVersion: before.layoutVersion, tables: [], fixtures: [] }] }),
      setFloorPlanLock: await setFloorPlanLock({ areaId, locked: true }),
      getFloorReach: await getFloorReach({ versions: { [areaId]: 1 } }),
      uploadFloorBackground: await uploadFloorBackground(form),
      removeFloorBackground: await removeFloorBackground({ areaId }),
      adjustFloorBackground: await adjustFloorBackground({ areaId, opacity: 0.5 }),
      saveFloorPlanLayout: await saveFloorPlanLayout({ areaId, name: "Off test" }),
      switchFloorPlanLayout: await switchFloorPlanLayout({ areaId, layoutVersion: before.layoutVersion, layoutId: null }),
      deleteFloorPlanLayout: await deleteFloorPlanLayout({ layoutId: "nope" }),
    };
    for (const [name, result] of Object.entries(results)) assert.deepEqual(result, { ok: false, error: OFF }, name);
    assert.deepEqual(await prisma.diningArea.findUniqueOrThrow({ where: { id: areaId }, select: { layoutVersion: true, isLocked: true, backgroundImage: true, updatedAt: true } }), before);
    assert.equal(await prisma.floorLayout.count(), layouts);
    assert.equal(await prisma.auditLog.count(), audit);
  });
});
