// Part 6f Step 7d against a real database (a throwaway copy): staff cards.
// An Administrator gives someone a card (kept as a keyed hash; its last
// characters shown; one person per card; logged without the code); the
// card signs them in on a PIN terminal like their PIN — an unknown card is
// a wrong guess, the Kitchen screen's rule holds, a disabled person can't —
// and taking it away stops it. Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/staffCard.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { cardHash, normaliseCard } from "@/lib/auth/staffCard";
import { KITCHEN_SCREEN_ONLY, pinSignIn, setPinTerminal, UNKNOWN_CARD } from "../server/services/pinSignIn";
import { findByCard, removeStaffCard, setStaffCard } from "../server/services/staffCard";
import { createStaff, disableStaff, enableStaff, getStaffPage, saveStaffSettings } from "../server/services/staff";
import { canTakeOrdersWhere } from "../server/services/orders";

// The card key comes from the login secret; the copy's test run has its own.
process.env.NEXTAUTH_SECRET ||= "card-check-secret-0123456789abcdef";
const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const stamp = Date.now().toString(36).slice(-4);
const device = randomUUID();
const CARD = `04 a1 b2 ${stamp} 9f`;
let admin = "";
let ada = "";
let tunde = "";
const now = new Date();

describe("Staff cards (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    const adminRole = (await prisma.role.findFirstOrThrow({ where: { isSystem: true, deletedAt: null }, select: { id: true } })).id;
    admin = (await prisma.user.findFirstOrThrow({ where: { roleId: adminRole, deletedAt: null, disabledAt: null }, select: { id: true } })).id;
    const waiter = (await prisma.role.findFirstOrThrow({ where: { systemRole: "WAITER" }, select: { id: true } })).id;
    await prisma.approvalPin.deleteMany({});
    await saveStaffSettings({ allowWeakPins: false, staffSelfPin: false }, admin);
    const person = (firstName: string, pin: string) => ({ firstName, lastName: `Card${stamp}`, displayName: "", roleId: waiter, colour: null, homeAreaId: null, homeStation: null, pin: { pin, confirm: pin } });
    const a = await createStaff(person("Ada", "3917"), admin);
    const t = await createStaff(person("Tunde", "5082"), admin);
    assert.ok(a.ok && t.ok);
    [ada, tunde] = [a.ok ? a.id : "", t.ok ? t.id : ""];
    await prisma.device.create({ data: { id: device, name: `Card terminal ${stamp}` } });
    await setPinTerminal({ deviceId: device, on: true }, admin);
  });
  after(async () => {
    await prisma.device.deleteMany({ where: { id: device } });
    await prisma.$disconnect();
  });

  test("a card number, tidied: no spaces, upper case, 4–64 printable — kept as a keyed hash", () => {
    assert.equal(normaliseCard(" 04 a1 B2 "), "04A1B2");
    for (const bad of ["abc", "", "x".repeat(65), 42]) assert.equal(normaliseCard(bad), null, String(bad));
    const h = cardHash("04A1B2");
    assert.ok(h && /^[0-9a-f]{64}$/.test(h) && h === cardHash("04A1B2") && h !== cardHash("04A1B3"));
  });

  test("give Ada a card (logged, never the code); someone else's card is refused", async () => {
    const set = await setStaffCard({ id: ada, code: CARD }, admin);
    const normal = normaliseCard(CARD)!;
    assert.deepEqual(set, { ok: true, label: `…${normal.slice(-4)}` });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ada }, select: { cardHash: true, cardLabel: true } });
    assert.equal(row.cardHash, cardHash(normal));
    assert.ok(!JSON.stringify(row).includes(normal), "the code itself isn't stored");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "staff.card.set", entityId: ada }, select: { meta: true } });
    assert.doesNotMatch(JSON.stringify(log.meta), new RegExp(normal));
    assert.equal((await getStaffPage()).staff.find((s) => s.id === ada)?.card, set.ok ? set.label : null);
    const taken = await setStaffCard({ id: tunde, code: CARD.toLowerCase() }, admin);
    assert.ok(!taken.ok && /^That card is Ada Card.*'s\. Take it off them first\.$/.test(taken.error), JSON.stringify(taken));
    assert.deepEqual(await setStaffCard({ id: tunde, code: "ab" }, admin), { ok: false, error: "That isn't a card number: 4 to 64 letters, digits or symbols." });
  });

  test("on a PIN terminal, the card signs Ada in (logged as a card); an unknown card is a wrong guess", async () => {
    const signed = await pinSignIn({ deviceId: device, userId: null, pin: "", card: CARD }, now);
    assert.ok(signed.ok && signed.user.id === ada, JSON.stringify(signed));
    assert.equal(await prisma.auditLog.count({ where: { action: "pin.signin", userId: ada, entityId: device, meta: { path: "$.method", equals: "card" } } }), 1);
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "", card: "DEADBEEF00" }, now), { ok: false, error: UNKNOWN_CARD });
    assert.equal((await prisma.device.findUniqueOrThrow({ where: { id: device }, select: { pinFailures: true } })).pinFailures, 1, "counted toward the lock-out");
    assert.deepEqual(await findByCard(CARD, canTakeOrdersWhere()), { id: ada, firstName: "Ada" }, "the POS switch finds her too");
  });

  test("the Kitchen screen's rule holds for a card; a disabled person's card doesn't sign in", async () => {
    await setPinTerminal({ deviceId: device, on: true, kind: "KITCHEN" }, admin);
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "", card: CARD }, now), { ok: false, error: KITCHEN_SCREEN_ONLY });
    await setPinTerminal({ deviceId: device, on: true, kind: "POS" }, admin);
    assert.deepEqual(await disableStaff({ id: ada, transferTo: null }, admin), { ok: true, transferred: 0 });
    assert.deepEqual(await pinSignIn({ deviceId: device, userId: null, pin: "", card: CARD }, now), { ok: false, error: UNKNOWN_CARD });
    await enableStaff(ada, admin);
  });

  test("taken away (logged): the card no longer signs in, and can go to someone else", async () => {
    assert.deepEqual(await removeStaffCard(ada, admin), { ok: true, label: null });
    assert.equal(await prisma.auditLog.count({ where: { action: "staff.card.remove", entityId: ada } }), 1);
    assert.equal(await findByCard(CARD, canTakeOrdersWhere()), null);
    assert.ok((await setStaffCard({ id: tunde, code: CARD }, admin)).ok);
    assert.equal((await findByCard(CARD, canTakeOrdersWhere()))?.id, tunde);
  });
});
