// Part 6f Step 6 against a real database (a throwaway copy): clock in / out
// (off: refused; on: a shift starts once a day, one left open from an
// earlier day closes AUTO, LOCK's End shift closes it; the PIN screen lists
// who's on shift) and a manager's override logged against both people.
// Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/shifts.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { getPinLoginScreen } from "../server/services/pinSignIn";
import { endShift, onShiftUserIds, setClockInOut, shiftStatus, startShift } from "../server/services/shifts";
import { createStaff, saveStaffSettings, setStaffPin } from "../server/services/staff";
import { logOverride, requireManager } from "../server/services/approvalPins";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const stamp = Date.now().toString(36).slice(-4);
// This run's own log rows only (the copy carries the live audit log).
const started = new Date(Date.now() - 1000);
let admin = "";
let ada = "";
let tunde = "";

describe("Shifts and overrides (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const adminRole = (await prisma.role.findFirstOrThrow({ where: { isSystem: true, deletedAt: null }, select: { id: true } })).id;
    admin = (await prisma.user.findFirstOrThrow({ where: { roleId: adminRole, deletedAt: null, disabledAt: null }, select: { id: true } })).id;
    const waiter = (await prisma.role.findFirstOrThrow({ where: { systemRole: "WAITER" }, select: { id: true } })).id;
    await prisma.approvalPin.deleteMany({});
    await saveStaffSettings({ allowWeakPins: false, staffSelfPin: false }, admin);
    const person = (firstName: string, pin: string) => ({ firstName, lastName: `Shift${stamp}`, displayName: "", roleId: waiter, colour: null, homeAreaId: null, homeStation: null, pin: { pin, confirm: pin } });
    const a = await createStaff(person("Ada", "3917"), admin);
    const t = await createStaff(person("Tunde", "5082"), admin);
    assert.ok(a.ok && t.ok);
    [ada, tunde] = [a.ok ? a.id : "", t.ok ? t.id : ""];
    await prisma.staffShift.deleteMany({});
    // Clock in / out off to start with (the copy carries the live setting).
    await setClockInOut(false, admin);
  });
  after(() => prisma.$disconnect());

  test("off (the default): no Start shift?, and starting one is refused", async () => {
    assert.deepEqual(await shiftStatus(ada), { clockOn: false, state: "OFF", askStart: false });
    assert.deepEqual(await startShift(ada, null), { ok: false, error: "Clock in / out is turned off (Settings › Staff)." });
  });

  test("on (logged): Start shift? is asked; a shift starts once a day; the PIN screen lists who's on shift", async () => {
    await setClockInOut(true, admin);
    assert.equal(await prisma.auditLog.count({ where: { action: "staff.settings", userId: admin, createdAt: { gte: started }, meta: { path: "$.to.clockInOut", equals: true } } }), 1);
    assert.equal((await shiftStatus(ada)).askStart, true);
    assert.equal((await getPinLoginScreen()).staff.length, 0, "nobody on shift yet");
    assert.deepEqual(await startShift(ada, null), { ok: true, started: true });
    assert.deepEqual(await startShift(ada, null), { ok: true, started: false }, "already on shift today");
    assert.deepEqual(await shiftStatus(ada), { clockOn: true, state: "ON", askStart: false });
    assert.deepEqual(await onShiftUserIds(), [ada]);
    const screen = await getPinLoginScreen();
    assert.deepEqual([screen.clockOn, screen.staff.map((s) => s.id)], [true, [ada]], "Tunde isn't on shift: not listed (his PIN still signs him in)");
    assert.equal(await prisma.auditLog.count({ where: { action: "shift.start", userId: ada } }), 1);
  });

  test("a shift left open from yesterday: Start shift? again, and starting closes the old one (AUTO)", async () => {
    const yesterday = new Date(Date.now() - 26 * 3600_000);
    const old = await prisma.staffShift.create({ data: { userId: tunde, startedAt: yesterday }, select: { id: true } });
    assert.deepEqual(await shiftStatus(tunde), { clockOn: true, state: "STALE", askStart: true });
    assert.ok(!(await onShiftUserIds()).includes(tunde));
    assert.deepEqual(await startShift(tunde, null), { ok: true, started: true });
    const closed = await prisma.staffShift.findUniqueOrThrow({ where: { id: old.id }, select: { endedAt: true, endReason: true } });
    assert.ok(closed.endedAt && closed.endReason === "AUTO");
    assert.equal(await prisma.staffShift.count({ where: { userId: tunde, endedAt: null } }), 1);
  });

  test("handover (Step 7a): ending a shift with open tables lists them and who can take them; then they move, logged", async () => {
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const order = await prisma.order.create({ data: { type: "TAKEAWAY", status: "SENT", warehouseId, waiterId: ada, guests: 2 }, select: { id: true, version: true } });
    const asked = await endShift(ada, null);
    assert.ok(!asked.ok && asked.needsHandover, JSON.stringify(asked));
    if (asked.ok || !asked.needsHandover) return;
    assert.equal(asked.error, "You have 1 open table. Hand it to someone else first.");
    assert.deepEqual(asked.needsHandover.orders.map((o) => [o.id, o.label, o.guests]), [[order.id, "Takeaway", 2]]);
    const tundeRow = asked.needsHandover.to.find((p) => p.id === tunde);
    assert.ok(tundeRow?.onShift, "Tunde is on shift, so he's offered (first)");
    assert.equal(asked.needsHandover.to[0].onShift, true);
    assert.ok(!asked.needsHandover.to.some((p) => p.id === ada), "not to herself");
    assert.equal(await prisma.staffShift.count({ where: { userId: ada, endedAt: null } }), 1, "nothing ended yet");

    assert.deepEqual(await endShift(ada, null, new Date(), { transferTo: ada }), { ok: false, error: "Pick someone else to take your tables." });
    assert.deepEqual(await endShift(ada, null, new Date(), { transferTo: tunde }), { ok: true, ended: 1, transferred: 1 });
    const moved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { waiterId: true, version: true } });
    assert.deepEqual([moved.waiterId, moved.version], [tunde, order.version + 1]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "shift.handover", userId: ada }, select: { entityId: true, meta: true } });
    assert.equal(log.entityId, tunde);
    assert.equal((log.meta as { count: number }).count, 1);
    await prisma.order.delete({ where: { id: order.id } });
    assert.deepEqual(await startShift(ada, null), { ok: true, started: true }, "back on shift for the next test");
  });

  test("End shift (at LOCK): every open shift ends, logged", async () => {
    assert.deepEqual(await endShift(ada, null), { ok: true, ended: 1, transferred: 0 });
    assert.deepEqual(await endShift(ada, null), { ok: true, ended: 0, transferred: 0 });
    const shift = await prisma.staffShift.findFirstOrThrow({ where: { userId: ada }, orderBy: { startedAt: "desc" }, select: { endedAt: true, endReason: true } });
    assert.ok(shift.endedAt && shift.endReason === "ENDED");
    assert.equal((await shiftStatus(ada)).askStart, true, "off shift: asked again next time");
    assert.equal(await prisma.auditLog.count({ where: { action: "shift.end", userId: ada, meta: { path: "$.reason", equals: "ENDED" } } }), 2, "the handover's and this one");
    await setClockInOut(false, admin);
  });

  test("a manager's override: the approver's PIN approves it (their id comes back), logged against both people", async () => {
    assert.ok((await setStaffPin({ id: admin, pin: { pin: "6193", confirm: "6193" } }, admin)).ok);
    const asked = await prisma.$transaction((tx) => requireManager(tx, { for: "VOID", may: false }));
    assert.ok(!asked.ok && "needsManager" in asked);
    const approved = await prisma.$transaction(async (tx) => {
      const result = await requireManager(tx, { for: "VOID", may: false, approval: { approverId: admin, pin: "6193" } });
      if (result.ok && result.approverId) await logOverride(tx, { kind: "void", actorId: ada, approverId: result.approverId, entityType: "OrderItem", entityId: `line_${stamp}`, meta: { orderId: `ord_${stamp}` } });
      return result;
    });
    assert.ok(approved.ok && approved.approverId === admin && !!approved.approvedBy);
    const rows = await prisma.auditLog.findMany({ where: { entityId: `line_${stamp}` }, orderBy: { action: "asc" }, select: { userId: true, action: true, meta: true } });
    assert.deepEqual(rows, [
      { userId: ada, action: "override.void", meta: { orderId: `ord_${stamp}`, approvedById: admin } },
      { userId: admin, action: "override.void.approve", meta: { orderId: `ord_${stamp}`, forUserId: ada } },
    ]);
    assert.doesNotMatch(JSON.stringify(rows), /6193/);
    const may = await prisma.$transaction((tx) => requireManager(tx, { for: "VOID", may: true }));
    assert.deepEqual(may, { ok: true, approvedBy: null, approverId: null }, "someone who may: no override");
  });
});
