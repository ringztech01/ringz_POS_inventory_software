// Part 6f Step 3 against a real database (a throwaway copy): adding PIN-only
// staff, PINs (rules, unique, generated, reset ends sessions), editing (the
// last Administrator stays one), disabling (open orders handed over first,
// sessions ended), enabling, the PIN settings and My PIN — each change in
// the audit log, never a PIN. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/staff.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { canTakeOrdersWhere } from "../server/services/orders";
import { changeOwnPin, createStaff, disableStaff, enableStaff, getStaffPage, saveStaffSettings, setStaffPin, updateStaff } from "../server/services/staff";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const stamp = Date.now().toString(36).slice(-4);
let admin = "";
let waiterRole = "";
let adminRole = "";
let ada = "";
let tunde = "";

const pinOf = async (userId: string) => prisma.approvalPin.findUniqueOrThrow({ where: { userId }, select: { pinHash: true, meetsRules: true } });
const fields = (firstName: string) => ({ firstName, lastName: `Check${stamp}`, displayName: "", roleId: waiterRole, colour: null, homeAreaId: null, homeStation: null });

describe("Staff (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    adminRole = (await prisma.role.findFirstOrThrow({ where: { isSystem: true, deletedAt: null }, select: { id: true } })).id;
    waiterRole = (await prisma.role.findFirstOrThrow({ where: { systemRole: "WAITER" }, select: { id: true } })).id;
    admin = (await prisma.user.findFirstOrThrow({ where: { roleId: adminRole, deletedAt: null }, select: { id: true } })).id;
    await prisma.role.update({ where: { id: waiterRole }, data: { permissions: { createMany: { data: [{ permission: "Manage Orders" }], skipDuplicates: true } } } });
    // Clear other PINs out of the way of the ones these tests pick.
    await prisma.approvalPin.deleteMany({});
    await saveStaffSettings({ allowWeakPins: false, staffSelfPin: false }, admin);
  });
  after(() => prisma.$disconnect());

  test("add: a PIN-only person (placeholder login, no usable password), their PIN hashed, logged without it", async () => {
    const made = await createStaff({ ...fields("Ada"), pin: { pin: "3917", confirm: "3917" } }, admin);
    assert.ok(made.ok, JSON.stringify(made));
    ada = made.ok ? made.id : "";
    assert.equal(made.ok && made.pin, null, "a typed PIN isn't sent back");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ada }, select: { email: true, pinOnly: true, password: true } });
    assert.ok(user.pinOnly && user.email.endsWith("@pin.local"));
    assert.ok(!(await bcrypt.compare("3917", user.password)), "the password isn't the PIN");
    const pin = await pinOf(ada);
    assert.ok((await bcrypt.compare("3917", pin.pinHash)) && pin.meetsRules);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "staff.create", entityId: ada } });
    assert.deepEqual(log.meta, { name: `Ada Check${stamp}`, role: "Waiter", pin: "typed" });
    assert.doesNotMatch(JSON.stringify(log.meta), /3917/);
    const row = (await getStaffPage()).staff.find((s) => s.id === ada)!;
    assert.deepEqual([row.displayName, row.email, row.pin, row.disabled], [`Ada C.`, null, "SET", false]);
  });

  test("PINs: 4 digits, not weak, nobody else's — refused with nothing made; generated ones are fine; the setting allows weak ones", async () => {
    const users = await prisma.user.count();
    const refused = async (pin: string) => {
      const r = await createStaff({ ...fields("Nope"), pin: { pin, confirm: pin } }, admin);
      return r.ok ? "made" : r.error;
    };
    assert.equal(await refused("1234"), "That PIN is too easy to guess (one of the PINs people guess first). Pick another.");
    assert.equal(await refused("7777"), "That PIN is too easy to guess (the same digit repeated). Pick another.");
    assert.equal(await refused("3917"), "Someone already has that PIN. Pick another.");
    assert.equal(await refused("391"), "A PIN is 4 digits.");
    assert.equal(await prisma.user.count(), users, "nobody added");

    const gen = await createStaff({ ...fields("Tunde"), pin: { generate: true } }, admin);
    assert.ok(gen.ok && gen.pin && /^\d{4}$/.test(gen.pin) && gen.pin !== "3917");
    tunde = gen.ok ? gen.id : "";
    assert.ok(await bcrypt.compare(gen.ok ? gen.pin! : "", (await pinOf(tunde)).pinHash), "the one shown is the one saved");

    await saveStaffSettings({ allowWeakPins: true, staffSelfPin: false }, admin);
    const weak = await setStaffPin({ id: tunde, pin: { pin: "2580", confirm: "2580" } }, admin);
    assert.ok(weak.ok, JSON.stringify(weak));
    await saveStaffSettings({ allowWeakPins: false, staffSelfPin: false }, admin);
    assert.equal((await prisma.auditLog.findFirstOrThrow({ where: { action: "staff.settings" }, orderBy: { createdAt: "desc" } })).userId, admin);
  });

  test("a reset ends every session (the version moves on); a first PIN doesn't", async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: ada }, select: { sessionVersion: true } })).sessionVersion;
    const reset = await setStaffPin({ id: ada, pin: { pin: "5082", confirm: "5082" } }, admin);
    assert.deepEqual(reset, { ok: true, pin: null, reset: true });
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ada }, select: { sessionVersion: true } })).sessionVersion, before + 1);
    assert.ok(await bcrypt.compare("5082", (await pinOf(ada)).pinHash));
    assert.deepEqual((await prisma.auditLog.findFirstOrThrow({ where: { action: "staff.pin.reset", entityId: ada } })).meta, { name: `Ada Check${stamp}`, pin: "typed", sessionsEnded: true });
  });

  test("edit: logged with what changed; the last Administrator can't be moved off the role", async () => {
    assert.ok((await updateStaff({ id: ada, ...fields("Ada"), displayName: "Ada O.", colour: "#2457A6" }, admin)).ok);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "staff.update", entityId: ada } });
    assert.deepEqual((log.meta as { changed: unknown }).changed, { displayName: { from: null, to: "Ada O." }, colour: { from: null, to: "#2457A6" } });
    const admins = await prisma.user.findMany({ where: { roleId: adminRole, deletedAt: null, disabledAt: null }, select: { id: true } });
    if (admins.length === 1) {
      const self = await prisma.user.findUniqueOrThrow({ where: { id: admin }, select: { firstName: true, lastName: true } });
      const r = await updateStaff({ id: admin, ...fields(self.firstName), lastName: self.lastName, roleId: waiterRole }, admin);
      assert.deepEqual(r, { ok: false, error: "The last Administrator can't be moved to another role." });
    }
  });

  test("disable: open orders first go to someone else; then can't take orders, sessions ended — logged; enable again", async () => {
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const order = await prisma.order.create({ data: { type: "TAKEAWAY", status: "OPEN", warehouseId, waiterId: ada }, select: { id: true, version: true } });
    const asked = await disableStaff({ id: ada, transferTo: null }, admin);
    assert.ok(!asked.ok && "needsTransfer" in asked && asked.needsTransfer.orders.length === 1 && asked.needsTransfer.to.some((p) => p.id === tunde), JSON.stringify(asked));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: ada }, select: { disabledAt: true } })).disabledAt, null, "not disabled yet");

    const sv = (await prisma.user.findUniqueOrThrow({ where: { id: ada }, select: { sessionVersion: true } })).sessionVersion;
    const done = await disableStaff({ id: ada, transferTo: tunde }, admin);
    assert.deepEqual(done, { ok: true, transferred: 1 });
    const moved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { waiterId: true, version: true } });
    assert.deepEqual([moved.waiterId, moved.version], [tunde, order.version + 1]);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ada }, select: { disabledAt: true, sessionVersion: true } });
    assert.ok(user.disabledAt && user.sessionVersion === sv + 1);
    assert.equal(await prisma.user.count({ where: { id: ada, ...canTakeOrdersWhere() } }), 0, "a disabled person can't take orders (or sign in by PIN)");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "staff.disable", entityId: ada } });
    assert.deepEqual((log.meta as { transferred: number; to: string }).transferred, 1);

    assert.deepEqual(await disableStaff({ id: admin, transferTo: null }, admin), { ok: false, error: "You can't disable yourself." });
    assert.deepEqual(await enableStaff(ada, admin), { ok: true });
    assert.equal(await prisma.user.count({ where: { id: ada, ...canTakeOrdersWhere() } }), 1);
    await prisma.order.delete({ where: { id: order.id } });
  });

  test("My PIN: refused unless the Administrator allows it; then it needs the current PIN and the same rules", async () => {
    assert.deepEqual(await changeOwnPin(ada, { oldPin: "5082", pin: "6193" }), { ok: false, error: "PINs are set by an Administrator (Settings › Staff)." });
    await saveStaffSettings({ allowWeakPins: false, staffSelfPin: true }, admin);
    assert.deepEqual(await changeOwnPin(ada, { oldPin: "0000", pin: "6193" }), { ok: false, error: "Your current PIN isn't right." });
    assert.deepEqual(await changeOwnPin(ada, { oldPin: "5082", pin: "4321" }), { ok: false, error: "That PIN is too easy to guess (one of the PINs people guess first). Pick another." });
    assert.deepEqual(await changeOwnPin(ada, { oldPin: "5082", pin: "6193" }), { ok: true });
    assert.ok(await bcrypt.compare("6193", (await pinOf(ada)).pinHash));
    assert.equal(await prisma.auditLog.count({ where: { action: "staff.pin.self", entityId: ada } }), 1);
    await saveStaffSettings({ allowWeakPins: false, staffSelfPin: false }, admin);
  });
});
