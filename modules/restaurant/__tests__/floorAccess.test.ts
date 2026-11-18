// Run with: npx tsx --test modules/restaurant/__tests__/floorAccess.test.ts
// Part 7 Step 7, read from the source: who can reach the floor plan editor,
// and the module switch. Every /restaurant/* page (and the POS tables
// screen) checks the module itself — a page renders alongside its layout, so
// it can't lean on the layout's check — every route handler does too (no
// layout runs before one), and every floor plan action checks Manage Floor
// Plan on the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
function filesUnder(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...filesUnder(rel, name));
    else if (entry === name) out.push(rel.split(path.sep).join("/"));
  }
  return out;
}
// A thin route file ("export { default } from '@/modules/…'"): the module file it hands to.
function target(routeFile: string): string {
  const source = read(routeFile);
  const from = source.match(/from\s+"@\/(modules\/[^"]+)"/)?.[1];
  if (!from) return routeFile;
  for (const ext of [".tsx", ".ts"]) {
    try {
      statSync(path.join(ROOT, from + ext));
      return from + ext;
    } catch {}
  }
  return routeFile;
}

const PAGE_GUARDS = /\b(guardPage|guardPageAny|guardFloorPlanPage|guardMenuQrPage|requireRestaurant)\(/;

test("every /restaurant/* page, and the POS tables screen, checks the module itself (a 404 while it's off)", () => {
  const pages = [...filesUnder("app/(dashboard)/restaurant", "page.tsx"), "app/(pos)/pos/floor/page.tsx", "app/(print)/restaurant/menu-cards/page.tsx"];
  assert.ok(pages.length >= 15, `found ${pages.length} pages`);
  const unguarded = pages.filter((page) => !PAGE_GUARDS.test(read(target(page))));
  assert.deepEqual(unguarded, []);
  assert.match(read("app/(dashboard)/restaurant/layout.tsx"), /await requireRestaurant\(\)/, "and the layout");
});

test("every /restaurant/* route handler checks the module and the permission (guardRoute)", () => {
  const routes = filesUnder("app/(dashboard)/restaurant", "route.ts");
  assert.deepEqual(routes.sort(), [
    "app/(dashboard)/restaurant/digital-menu/qr-codes/card/[kind]/[id]/route.ts",
    "app/(dashboard)/restaurant/food/media/[productId]/[kind]/route.ts",
    "app/(dashboard)/restaurant/food/media/[productId]/file/[file]/route.ts",
    "app/(dashboard)/restaurant/reports/export/[tab]/route.ts",
    "app/(dashboard)/restaurant/settings/floor/image/[areaId]/route.ts",
    "app/(dashboard)/restaurant/tables/[id]/qr/route.ts",
  ]);
  for (const route of routes) assert.match(read(target(route)), /const denied = await (guardRoute|guardMenuQrRoute)\(/, route);
  assert.match(read("modules/restaurant/server/routes/menuCardPng.ts"), /const denied = await guardMenuQrRoute\(\)/, "the menu card PNG: the Administrator or Manage Floor Plan");
  assert.match(read("modules/restaurant/server/routes/floorImage.ts"), /guardRoute\(RESTAURANT_PERMISSIONS\.MANAGE_FLOOR_PLAN\)/);
  for (const media of ["menuMediaUpload", "menuMediaFile"]) assert.match(read(`modules/restaurant/server/routes/${media}.ts`), /guardRoute\(RESTAURANT_PERMISSIONS\.MANAGE_FOOD\)/, `${media}: Manage Food`);
  assert.match(read("modules/restaurant/server/reportExportRoute.ts"), /guardRoute\(RESTAURANT_PERMISSIONS\.RESTAURANT_REPORTS\)/, "the Reports export: Restaurant Reports");
});

test("the editor page: redirected on the server without Manage Floor Plan (not just a hidden link)", () => {
  assert.match(read("modules/restaurant/pages/FloorPlanPage.tsx"), /await guardFloorPlanPage\(\)/);
  const guard = read("modules/restaurant/server/guard.ts");
  const page = guard.slice(guard.indexOf("export async function guardFloorPlanPage"));
  assert.match(page, /await requireRestaurant\(\)/);
  assert.match(page, /if \(!current\.permissions\.has\(RESTAURANT_PERMISSIONS\.MANAGE_FLOOR_PLAN\)\) redirect\("\/"\)/);
  assert.match(guard, /TODO\(6f\): also require accessLevel BACK_OFFICE/);
});

test("every floor plan action checks Manage Floor Plan first; the image ones the Administrator too", () => {
  const source = read("modules/restaurant/server/actions/floorPlan.ts");
  const actions = source.split(/\nexport async function /).slice(1).map((chunk) => ({ name: chunk.slice(0, chunk.indexOf("(")), body: chunk }));
  assert.deepEqual(actions.map((a) => a.name).sort(), [
    "adjustFloorBackground",
    "deleteFloorPlanLayout",
    "getFloorReach",
    "removeFloorBackground",
    "saveFloorPlan",
    "saveFloorPlanLayout",
    "setFloorPlanLock",
    "switchFloorPlanLayout",
    "uploadFloorBackground",
  ]);
  for (const action of actions) {
    const check = action.body.search(/await (requireFloorPlan|requireImageAdmin)\(\)/);
    const work = action.body.search(/await (saveFloorPlanService|setFloorLock|storeFloorImage|removeFloorImage|adjustFloorImage|saveFloorLayout|switchFloorLayout|deleteFloorLayout)\(|floorReach\(/);
    assert.ok(check >= 0 && check < work, `${action.name} checks before it does anything`);
  }
  for (const name of ["uploadFloorBackground", "removeFloorBackground", "adjustFloorBackground"]) assert.match(actions.find((a) => a.name === name)!.body, /requireImageAdmin\(\)/, name);
  const admin = source.slice(source.indexOf("async function requireImageAdmin"));
  assert.match(admin.slice(0, 400), /requireFloorPlan\(\)[\s\S]*isSystemAdmin\(/);
});

test("no `any` in the floor plan code", () => {
  const files = [
    "lib/audit.ts",
    ...["floorGeometry", "floorImage", "floorLayouts", "floorPresence", "floorRules", "floorView"].map((f) => `modules/restaurant/lib/${f}.ts`),
    ...["floorPlan", "floorImage", "floorLayouts"].map((f) => `modules/restaurant/server/services/${f}.ts`),
    "modules/restaurant/server/actions/floorPlan.ts",
    "modules/restaurant/server/queries/floorPlan.ts",
    "modules/restaurant/server/floorPresence.ts",
    "modules/restaurant/server/routes/floorImage.ts",
    "modules/restaurant/schemas/floorPlan.ts",
    "modules/restaurant/components/floorPlan/FloorEditor.tsx",
    "modules/restaurant/components/pos/FloorRoom.tsx",
    "modules/restaurant/pages/FloorPlanPage.tsx",
  ];
  const offenders = files.filter((file) => /(:\s*any\b|\bas any\b|<any>|any\[\])/.test(read(file)));
  assert.deepEqual(offenders, []);
});
