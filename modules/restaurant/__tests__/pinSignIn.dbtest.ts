// Part 6f Step 4 against a real database (a throwaway copy): PIN sign-in only
// on a paired device; a PIN alone (or a tapped name and the PIN) finds its
// person — Kitchen staff too; wrong PINs lock the device (30 s, then 60 s),
// each one logged, never the PIN; disabled people can't; the home screen
// (their own over the role's); the PIN screen's names (hidden by the
// setting); the recovery code (an Administrator's email, works once).
// Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/pinSignIn.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { createRecoveryCode, recoveryCodeMadeAt, redeemRecoveryCode } from "@/lib/auth/recovery";
import { routesFor } from "../lib/serviceRoutes";
import { getPinLoginScreen, pinSignIn, setPinHideNames, setPinTerminal, signedInLanding, staffHome, staffHomeOn } from "../server/services/pinSignIn";
import { createStaff, disableStaff, enableStaff, saveStaffSettings } from "../server/services/staff";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const stamp = Date.now().toString(36).slice(-4);
// This run's own log rows only (the copy carries the live audit log).
const started = new Date(Date.now() - 1000);
const device = randomUUID();
const SERVICE = routesFor("SERVICE");
let admin = "";
let adminEmail = "";
let waiterRole = "";
let kitchenRole = "";
let ada = "";
let kemi = "";
let clock = new Date("2026-11-11T12:00:00Z");
const later = (seconds: number) => (clock = new Date(clock.getTime() + seconds * 1000));
const resetRecoveryThrottle = () => ((globalThis as { __recoveryGuesses?: unknown }).__recoveryGuesses = undefined);

const person = (firstName: string, roleId: string, pin: string) => ({ firstName, lastName: `Pin${stamp}`, displayName: "", roleId, colour: null, homeAreaId: null, homeStation: null, pin: { pin, confirm: pin } });
const fails = () => prisma.auditLog.count({ where: { action: "pin.signin.fail", entityId: device } });

describe("PIN sign-in (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const adminRole = (await prisma.role.findFirstOrThrow({ where: { isSystem: true, deletedAt: null }, select: { id: true } })).id;
    const first = await prisma.user.findFirstOrThrow({ where: { roleId: adminRole, deletedAt: null, disabledAt: null, pinOnly: false }, select: { id: true, email: true } });
    [admin, adminEmail] = [first.id, first.email];
    waiterRole = (await prisma.role.findFirstOrThrow({ where: { systemRole: "WAITER" }, select: { id: true } })).id;
    kitchenRole = (await prisma.role.findFirstOrThrow({ where: { systemRole: "KITCHEN" }, select: { id: true } })).id;
    await prisma.approvalPin.deleteMany({});
    await saveStaffSettings({ allowWeakPins: false, staffSelfPin: false }, admin);
    // The PIN screen lists everyone only with Clock in / out off (the copy carries the live setting).
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantClockInOut: false, restaurantPinHideNames: false } });
    const a = await createStaff(person("Ada", waiterRole, "3917"), admin);
    const k = await createStaff(person("Kemi", kitchenRole, "5082"), admin);
    assert.ok(a.ok && k.ok, JSON.stringify([a, k]));
    [ada, kemi] = [a.ok ? a.id : "", k.ok ? k.id : ""];
    await prisma.device.create({ data: { id: device, name: `Check terminal ${stamp}` } });
  });
  after(async () => {
    await prisma.device.deleteMany({ where: { id: device } });
    await prisma.$disconnect();
  });

  test("not paired: no PIN sign-in on it at all", async () => {
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "3917" }, clock), { ok: false, error: "This device isn't a PIN terminal. Sign in with your email instead." });
    assert.equal(await fails(), 0, "not a guess: nothing counted");
  });

  test("paired (logged): a PIN alone signs its person in — a Waiter, and Kitchen staff (who don't take orders)", async () => {
    assert.deepEqual(await setPinTerminal({ deviceId: device, on: true }, admin), { ok: true });
    const paired = await prisma.device.findUniqueOrThrow({ where: { id: device }, select: { pinLogin: true, pairedAt: true } });
    assert.ok(paired.pinLogin && paired.pairedAt);
    assert.equal(await prisma.auditLog.count({ where: { action: "device.pin.pair", entityId: device, userId: admin } }), 1);

    const one = await pinSignIn({ deviceId: device, userId: null, pin: "3917" }, clock);
    assert.deepEqual(one, { ok: true, user: { id: ada, firstName: "Ada", name: "Ada P." } });
    const two = await pinSignIn({ deviceId: device, userId: kemi, pin: "5082" }, clock);
    assert.ok(two.ok && two.user.id === kemi, JSON.stringify(two));
    const logs = await prisma.auditLog.findMany({ where: { action: "pin.signin", entityId: device }, orderBy: { createdAt: "asc" }, select: { userId: true, meta: true } });
    assert.deepEqual(logs.map((l) => [l.userId, l.meta]), [[ada, { tapped: false }], [kemi, { tapped: true }]]);
  });

  test("wrong PINs: four told to try again, the fifth locks the device 30 s (even a right PIN waits); every one logged without the PIN", async () => {
    for (let i = 0; i < 4; i++) assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "6193" }, clock), { ok: false, error: "That PIN isn't right. Try again." });
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "6193" }, clock), { ok: false, error: "Too many attempts · wait 30 seconds", waitSeconds: 30 });
    assert.equal(await fails(), 5);
    later(10);
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "3917" }, clock), { ok: false, error: "Too many attempts · wait 20 seconds", waitSeconds: 20 });
    assert.equal(await fails(), 5, "a try while locked isn't a guess");
    const logged = await prisma.auditLog.findMany({ where: { action: "pin.signin.fail", entityId: device }, select: { meta: true, userId: true } });
    assert.ok(logged.every((l) => l.userId === null));
    assert.doesNotMatch(JSON.stringify(logged), /6193/);

    later(21);
    for (let i = 0; i < 5; i++) await pinSignIn({ deviceId: device, userId: null, pin: "6193" }, clock);
    const d = await prisma.device.findUniqueOrThrow({ where: { id: device }, select: { pinLockedUntil: true, pinLockLevel: true } });
    assert.equal(d.pinLockedUntil!.getTime() - clock.getTime(), 60_000, "the second lock is longer");
    assert.equal(d.pinLockLevel, 2);

    later(61);
    assert.ok((await pinSignIn({ deviceId: device, userId: null, pin: "3917" }, clock)).ok);
    assert.deepEqual(await prisma.device.findUniqueOrThrow({ where: { id: device }, select: { pinFailures: true, pinLockedUntil: true, pinLockLevel: true } }), { pinFailures: 0, pinLockedUntil: null, pinLockLevel: 0 }, "a right PIN starts over");
  });

  test("a tapped name with the wrong PIN counts on the device too; a disabled person can't sign in", async () => {
    const r = await pinSignIn({ deviceId: device, userId: ada, pin: "6193" }, clock);
    assert.deepEqual(r, { ok: false, error: "That PIN isn't right. Try again." });
    assert.equal((await prisma.device.findUniqueOrThrow({ where: { id: device }, select: { pinFailures: true } })).pinFailures, 1);
    assert.deepEqual(await disableStaff({ id: kemi, transferTo: null }, admin), { ok: true, transferred: 0 });
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "5082" }, clock), { ok: false, error: "That PIN isn't right. Try again." });
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: kemi, pin: "5082" }, clock), { ok: false, error: "That person can't sign in here. Type your PIN." });
    await enableStaff(kemi, admin);
    assert.ok((await pinSignIn({ deviceId: device, userId: null, pin: "5082" }, clock)).ok);
  });

  test("home: the role's (Waiter → Tables, Kitchen → the kitchen display), the person's own area over it; the back office isn't sent to a home off a terminal", async () => {
    assert.match(await staffHome(ada, SERVICE), /^\/pos\/floor/);
    assert.match(await staffHome(kemi, SERVICE), /^\/restaurant\/kitchen/);
    const area = await prisma.diningArea.findFirst({ where: { deletedAt: null }, select: { id: true } });
    if (area) {
      await prisma.user.update({ where: { id: ada }, data: { homeAreaId: area.id } });
      assert.equal(await staffHome(ada, SERVICE), SERVICE.tables({ areaId: area.id, focus: null }));
    }
    assert.equal(await signedInLanding(admin, null, SERVICE), null, "an Administrator off a terminal: the dashboard");
    assert.ok(await signedInLanding(admin, device, SERVICE), "on a terminal: their home");
    assert.ok(await signedInLanding(ada, null, SERVICE), "Service-level: their home");
  });

  test("the proxy's home (Step 5): this device's own view over the business's — Classic sends a Waiter to the Classic floor", async () => {
    const business = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantInterface: true } })).restaurantInterface;
    const expected = business === "CLASSIC" ? /^\/restaurant\/floor/ : /^\/pos\/floor/;
    assert.match(await staffHomeOn(ada, device), expected, "the device follows the business");
    assert.match(await staffHomeOn(ada, null), expected, "no device cookie: the business's");
    await prisma.device.update({ where: { id: device }, data: { restaurantInterface: "CLASSIC" } });
    assert.match(await staffHomeOn(ada, device), /^\/restaurant\/floor/);
    assert.match(await staffHomeOn(kemi, device), /^\/restaurant\/kitchen/, "Kitchen: the kitchen display either way");
    await prisma.device.update({ where: { id: device }, data: { restaurantInterface: null } });
  });

  test("the PIN screen's names: everyone with a PIN, the latest sign-in first — or none, when hidden (logged)", async () => {
    await prisma.user.update({ where: { id: kemi }, data: { lastLoginAt: new Date(Date.now() + 60_000) } });
    const shown = await getPinLoginScreen();
    assert.equal(shown.hideNames, false);
    assert.equal(shown.staff[0]?.id, kemi);
    assert.ok(shown.staff.some((s) => s.id === ada && s.name === "Ada P." && s.role === "Waiter"));
    await setPinHideNames(true, admin);
    const hidden = await getPinLoginScreen();
    assert.deepEqual([hidden.staff, hidden.hideNames, hidden.kind], [[], true, "POS"]);
    await setPinHideNames(false, admin);
    assert.equal(await prisma.auditLog.count({ where: { action: "staff.settings", userId: admin, createdAt: { gte: started }, meta: { path: "$.to.hidePinNames", equals: true } } }), 1);
  });

  test("recovery code: an Administrator's email and the code sign in once; a new code replaces the old; logged, the code never", async () => {
    resetRecoveryThrottle();
    const old = await createRecoveryCode(admin);
    const code = await createRecoveryCode(admin);
    assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
    assert.ok(await recoveryCodeMadeAt());
    assert.equal(await redeemRecoveryCode(adminEmail, old), null, "the old code stopped working");
    const waiterEmail = (await prisma.user.findUniqueOrThrow({ where: { id: ada }, select: { email: true } })).email;
    assert.equal(await redeemRecoveryCode(waiterEmail, code), null, "not an Administrator");
    const user = await redeemRecoveryCode(adminEmail, code.toLowerCase().replace(/-/g, " "));
    assert.equal(user?.id, admin, "typed loosely, still the code");
    assert.equal(await recoveryCodeMadeAt(), null, "used up");
    assert.equal(await redeemRecoveryCode(adminEmail, code), null, "works once");
    assert.equal(await prisma.auditLog.count({ where: { action: "recovery.use", userId: admin } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { action: "recovery.create", userId: admin } }), 2);
    const all = await prisma.auditLog.findMany({ where: { action: { startsWith: "recovery." } }, select: { meta: true } });
    assert.doesNotMatch(JSON.stringify(all), new RegExp(code.replace(/-/g, "").slice(0, 10)));
    resetRecoveryThrottle();
  });

  test("unpaired again (logged): no more PIN sign-in", async () => {
    await setPinTerminal({ deviceId: device, on: false }, admin);
    assert.equal(await prisma.auditLog.count({ where: { action: "device.pin.unpair", entityId: device } }), 1);
    assert.equal((await pinSignIn({ deviceId: device, userId: null, pin: "3917" }, clock)).ok, false);
  });
});
