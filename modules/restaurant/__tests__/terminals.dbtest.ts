// Part 6f Step 7c against a real database (a throwaway copy): device roles.
// The Kitchen screen signs in Kitchen staff and managers only (a Waiter's
// right PIN is refused, logged, not counted as a guess), lists only them and
// opens the kitchen display; a Bar terminal opens Tables on its area (or the
// Bartender's), bar tabs first. Each pairing change is logged. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/terminals.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getPinLoginScreen, KITCHEN_SCREEN_ONLY, pinSignIn, setPinTerminal, staffHomeOn } from "../server/services/pinSignIn";
import { createStaff, saveStaffSettings } from "../server/services/staff";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const stamp = Date.now().toString(36).slice(-4);
const device = randomUUID();
let admin = "";
let ada = "";
let kemi = "";
let barArea = "";
const now = new Date();

describe("Device roles (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const adminRole = (await prisma.role.findFirstOrThrow({ where: { isSystem: true, deletedAt: null }, select: { id: true } })).id;
    admin = (await prisma.user.findFirstOrThrow({ where: { roleId: adminRole, deletedAt: null, disabledAt: null }, select: { id: true } })).id;
    const waiter = (await prisma.role.findFirstOrThrow({ where: { systemRole: "WAITER" }, select: { id: true } })).id;
    const kitchen = (await prisma.role.findFirstOrThrow({ where: { systemRole: "KITCHEN" }, select: { id: true } })).id;
    await prisma.approvalPin.deleteMany({});
    await saveStaffSettings({ allowWeakPins: false, staffSelfPin: false }, admin);
    const person = (firstName: string, roleId: string, pin: string) => ({ firstName, lastName: `Term${stamp}`, displayName: "", roleId, colour: null, homeAreaId: null, homeStation: null, pin: { pin, confirm: pin } });
    const a = await createStaff(person("Ada", waiter, "3917"), admin);
    const k = await createStaff(person("Kemi", kitchen, "5082"), admin);
    assert.ok(a.ok && k.ok);
    [ada, kemi] = [a.ok ? a.id : "", k.ok ? k.id : ""];
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    barArea = (await prisma.diningArea.create({ data: { name: `Bar ${stamp}`, warehouseId }, select: { id: true } })).id;
    await prisma.device.create({ data: { id: device, name: `Terminal ${stamp}` } });
  });
  after(async () => {
    await prisma.device.deleteMany({ where: { id: device } });
    await prisma.$disconnect();
  });

  test("the Kitchen screen (logged): Kitchen staff sign in; a Waiter's right PIN is refused, logged, not counted as a guess", async () => {
    assert.deepEqual(await setPinTerminal({ deviceId: device, on: true, kind: "KITCHEN" }, admin), { ok: true });
    assert.equal(await prisma.auditLog.count({ where: { action: "device.pin.pair", entityId: device, meta: { path: "$.kind", equals: "KITCHEN" } } }), 1);
    const kitchen = await pinSignIn({ deviceId: device, userId: null, pin: "5082" }, now);
    assert.ok(kitchen.ok && kitchen.user.id === kemi, JSON.stringify(kitchen));
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "3917" }, now), { ok: false, error: KITCHEN_SCREEN_ONLY });
    assert.equal((await prisma.device.findUniqueOrThrow({ where: { id: device }, select: { pinFailures: true } })).pinFailures, 0, "not a guess");
    assert.equal(await prisma.auditLog.count({ where: { action: "pin.signin.refused", userId: ada, entityId: device } }), 1);
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "6193" }, now), { ok: false, error: "That PIN isn't right. Try again." }, "a wrong PIN is still a wrong PIN");
  });

  test("the Kitchen screen lists only who signs in there, and opens the kitchen display", async () => {
    const screen = await getPinLoginScreen(device);
    assert.equal(screen.kind, "KITCHEN");
    assert.ok(screen.staff.some((s) => s.id === kemi));
    assert.ok(!screen.staff.some((s) => s.id === ada), "no Waiter on the kitchen screen's list");
    assert.match(await staffHomeOn(kemi, device), /^\/restaurant\/kitchen/);
    assert.match(await staffHomeOn(admin, device), /^\/restaurant\/kitchen/, "a manager too");
    assert.equal((await getPinLoginScreen(null)).kind, "POS");
  });

  test("a Bar terminal (logged): Tables on its area with the bar tabs first; with no area, the Bartender's", async () => {
    assert.deepEqual(await setPinTerminal({ deviceId: device, on: true, kind: "BAR", areaId: barArea }, admin), { ok: true });
    assert.equal(await prisma.auditLog.count({ where: { action: "device.terminal.change", entityId: device } }), 1);
    const home = await staffHomeOn(ada, device);
    assert.ok(home.includes(barArea) && /focus=bar/.test(home), home);
    assert.ok((await pinSignIn({ deviceId: device, userId: null, pin: "3917" }, now)).ok, "anyone signs in at the bar");
    await setPinTerminal({ deviceId: device, on: true, kind: "BAR", areaId: null }, admin);
    const bartender = await prisma.role.findFirst({ where: { systemRole: "BARTENDER", deletedAt: null }, select: { homeAreaId: true } });
    const fallback = await staffHomeOn(ada, device);
    assert.ok(/focus=bar/.test(fallback) && (!bartender?.homeAreaId || fallback.includes(bartender.homeAreaId)), fallback);
    assert.deepEqual(await setPinTerminal({ deviceId: device, on: true, kind: "BAR", areaId: "nope" }, admin), { ok: false, error: "That area has been removed. Pick another." });
  });

  test("unpaired: back to a plain device (its role and area cleared); its home is the person's own", async () => {
    await setPinTerminal({ deviceId: device, on: false }, admin);
    const d = await prisma.device.findUniqueOrThrow({ where: { id: device }, select: { pinLogin: true, terminalRole: true, homeAreaId: true } });
    assert.deepEqual(d, { pinLogin: false, terminalRole: "POS", homeAreaId: null });
    assert.doesNotMatch(await staffHomeOn(ada, device), /focus=bar/);
  });
});
