// Part 8 Step 2 against a real database (a throwaway copy): Digital menu ›
// QR codes. No cards until the menu's address is saved; then each card's
// code opens <address>/menu/<that table's token>. Rotating gives a new token
// at once (the old one finds nothing) and notes when; QR points are added,
// renamed and removed, each with its own token; everything is in the audit
// log (the Wi-Fi password never). With the module off, the actions refuse
// and the PNG answers 404. (Signed out and other roles need a real request:
// the browser check r117 covers them.) Needs:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/menuQr.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { newQrToken } from "../lib/qrToken";
import { addQrPoint, removeQrPoint, renameQrPoint, rotateQr, saveMenuAddress, saveMenuDesign, saveMenuWifi } from "../server/services/menuQr";
import { loadPublicMenu, menuDesign } from "../server/queries/publicMenu";
import { buildMenuCards, getMenuQrPage } from "../server/queries/menuQr";
import { findTableByQrToken } from "../server/queries/tables";
import { savedMenuAddress } from "../server/qr";
import { rotateMenuQrAction, saveMenuAddressAction } from "../server/actions/menuQr";
import { GET as cardPng } from "../server/routes/menuCardPng";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");
const skip = enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database";

let userId = "";
let tableId = "";
const original: { address: string | null; wifiName: string | null; wifiPassword: string | null } = { address: null, wifiName: null, wifiPassword: null };

describe("Digital menu QR codes (database copy)", { skip }, () => {
  before(async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { roleId: true } });
    userId = (await prisma.user.create({ data: { firstName: "Qira", lastName: "Codes", email: `qira-${Date.now()}@check.test`, password: "x", roleId: admin.roleId }, select: { id: true } })).id;
    const area = await prisma.diningArea.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } });
    tableId = (await prisma.table.create({ data: { name: `QR${Date.now() % 100000}`, seats: 2, areaId: area.id, qrToken: newQrToken() }, select: { id: true } })).id;
    const s = await prisma.menuSettings.findFirstOrThrow();
    Object.assign(original, { address: s.menuBaseUrl, wifiName: s.wifiName, wifiPassword: s.wifiPassword });
    await prisma.menuSettings.update({ where: { id: s.id }, data: { menuBaseUrl: null, wifiName: null, wifiPassword: null } });
  });
  after(async () => {
    await prisma.menuSettings.updateMany({ data: { menuBaseUrl: original.address, wifiName: original.wifiName, wifiPassword: original.wifiPassword } });
    await prisma.qrPoint.deleteMany({ where: { name: { startsWith: "QR check" } } });
  });

  test("no address saved: no cards (nothing printed)", async () => {
    assert.equal(await savedMenuAddress(), null);
    assert.equal(await buildMenuCards({ all: true }), null);
  });

  test("the address saved (and logged): each card's code opens <address>/menu/<its own token>", async () => {
    assert.deepEqual(await saveMenuAddress("http://192.168.1.20:3000", userId), { ok: true });
    assert.equal(await savedMenuAddress(), "http://192.168.1.20:3000");
    const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId }, select: { name: true, qrToken: true } });
    const [card] = (await buildMenuCards({ kind: "table", id: tableId }))!;
    assert.equal(card.title, `Table ${table.name}`);
    assert.ok(card.svg.includes(`>http://192.168.1.20:3000/menu/${table.qrToken}</text>`));
    const page = await getMenuQrPage();
    assert.equal((await buildMenuCards({ all: true }))!.length, page.tables.length + page.points.length, "Print all: every table and point");
    assert.equal(await prisma.auditLog.count({ where: { userId, action: "menu.address.update" } }), 1);
    await saveMenuAddress("http://192.168.1.20:3000", userId);
    assert.equal(await prisma.auditLog.count({ where: { userId, action: "menu.address.update" } }), 1, "the same address again isn't logged twice");
  });

  test("rotate a table's code: a new token at once, the old one finds nothing; when it changed; logged", async () => {
    const before = await prisma.table.findUniqueOrThrow({ where: { id: tableId }, select: { qrToken: true } });
    assert.equal((await findTableByQrToken(before.qrToken))?.id, tableId);
    assert.deepEqual(await rotateQr("table", tableId, userId), { ok: true });
    const afterRotate = await prisma.table.findUniqueOrThrow({ where: { id: tableId }, select: { qrToken: true, qrRotatedAt: true } });
    assert.notEqual(afterRotate.qrToken, before.qrToken);
    assert.match(afterRotate.qrToken, /^[A-Za-z0-9_-]{24}$/);
    assert.ok(afterRotate.qrRotatedAt && Date.now() - afterRotate.qrRotatedAt.getTime() < 60_000);
    assert.equal(await findTableByQrToken(before.qrToken), null, "the old printed code stops working");
    assert.equal((await findTableByQrToken(afterRotate.qrToken))?.id, tableId);
    const [card] = (await buildMenuCards({ kind: "table", id: tableId }))!;
    assert.ok(card.svg.includes(afterRotate.qrToken) && !card.svg.includes(before.qrToken), "the card carries the new one");
    assert.equal(await prisma.auditLog.count({ where: { userId, action: "menu.qr.rotate", entityType: "Table", entityId: tableId } }), 1);
    assert.deepEqual(await rotateQr("table", "no-such-table", userId), { ok: false, error: "That QR code can't be found. It may have been removed." });
  });

  test("QR points: added with their own token; a name used twice refused; renamed; rotated; removed (its code dead)", async () => {
    const added = await addQrPoint({ name: "QR check counter", orderType: "TAKEAWAY" }, userId);
    assert.ok(added.ok && added.id);
    const id = added.id!;
    const point = await prisma.qrPoint.findUniqueOrThrow({ where: { id } });
    assert.match(point.qrToken, /^[A-Za-z0-9_-]{24}$/);
    assert.equal(point.orderType, "TAKEAWAY");
    assert.deepEqual(await addQrPoint({ name: "QR check counter", orderType: "BAR_TAB" }, userId), { ok: false, error: "A QR point with that name already exists." });
    const bar = await addQrPoint({ name: "QR check bar", orderType: "BAR_TAB" }, userId);
    assert.ok(bar.ok);
    assert.deepEqual(await renameQrPoint(id, "QR check bar", userId), { ok: false, error: "A QR point with that name already exists." });
    assert.deepEqual(await renameQrPoint(id, "QR check takeaway", userId), { ok: true });
    assert.equal((await prisma.qrPoint.findUniqueOrThrow({ where: { id } })).name, "QR check takeaway");
    assert.deepEqual(await rotateQr("point", id, userId), { ok: true });
    const rotated = await prisma.qrPoint.findUniqueOrThrow({ where: { id } });
    assert.notEqual(rotated.qrToken, point.qrToken);
    assert.ok(rotated.qrRotatedAt);
    const [card] = (await buildMenuCards({ kind: "point", id }))!;
    assert.equal(card.title, "QR check takeaway");
    assert.ok(card.svg.includes(">Takeaway</text>"));
    assert.deepEqual(await removeQrPoint(id, userId), { ok: true });
    assert.equal(await prisma.qrPoint.count({ where: { qrToken: rotated.qrToken, deletedAt: null } }), 0, "a removed point's code opens nothing");
    assert.deepEqual(await buildMenuCards({ kind: "point", id }), [], "no card for it");
    assert.deepEqual(await rotateQr("point", id, userId), { ok: false, error: "That QR code can't be found. It may have been removed." });
    const actions = (await prisma.auditLog.findMany({ where: { userId, entityType: "QrPoint", entityId: id }, orderBy: { createdAt: "asc" }, select: { action: true } })).map((a) => a.action);
    assert.deepEqual(actions, ["menu.point.create", "menu.point.rename", "menu.qr.rotate", "menu.point.remove"]);
  });

  test("Wi-Fi: printed on the cards; no name, no password; the password never in the audit log", async () => {
    await saveMenuWifi("Ringz Guest", "jollof2026", userId);
    const [card] = (await buildMenuCards({ kind: "table", id: tableId }))!;
    assert.ok(card.svg.includes(">Wi-Fi: Ringz Guest</text>") && card.svg.includes(">Password: jollof2026</text>"));
    await saveMenuWifi("", "stray", userId);
    const s = await prisma.menuSettings.findFirstOrThrow();
    assert.deepEqual([s.wifiName, s.wifiPassword], [null, null]);
    const logged = await prisma.auditLog.findMany({ where: { userId, action: "menu.wifi.update" }, select: { meta: true } });
    assert.equal(logged.length, 2);
    assert.ok(!JSON.stringify(logged).includes("jollof2026"), "no password in the log");
  });
});

describe("The menu design (database copy)", { skip }, () => {
  test("Showcase by default; Classic saved and logged once; the guest's page follows; back to Showcase", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } });
    const table = await prisma.table.findFirstOrThrow({ where: { deletedAt: null, area: { deletedAt: null } }, select: { qrToken: true } });
    const s = await prisma.menuSettings.findFirstOrThrow();
    const was = s.menuDesign;
    try {
      await prisma.menuSettings.update({ where: { id: s.id }, data: { menuDesign: "SHOWCASE" } });
      assert.equal((await getMenuQrPage()).design, "SHOWCASE");
      assert.equal(await menuDesign(), "SHOWCASE");
      const shown = await loadPublicMenu(table.qrToken);
      assert.equal(shown.kind === "menu" ? shown.design : shown.kind, "SHOWCASE");

      const since = new Date(Date.now() - 1000);
      await saveMenuDesign("CLASSIC", admin.id);
      await saveMenuDesign("CLASSIC", admin.id);
      assert.equal((await getMenuQrPage()).design, "CLASSIC");
      assert.equal(await menuDesign(), "CLASSIC");
      const classic = await loadPublicMenu(table.qrToken);
      assert.equal(classic.kind === "menu" ? classic.design : classic.kind, "CLASSIC");
      const logged = await prisma.auditLog.findMany({ where: { userId: admin.id, action: "menu.design.update", createdAt: { gte: since } }, select: { meta: true } });
      assert.deepEqual(logged.map((l) => l.meta), [{ from: "SHOWCASE", to: "CLASSIC" }], "logged once: the second save changed nothing");

      await saveMenuDesign("SHOWCASE", admin.id);
      assert.equal(await menuDesign(), "SHOWCASE");
    } finally {
      await prisma.menuSettings.update({ where: { id: s.id }, data: { menuDesign: was } });
    }
  });
});

describe("Module off: Digital menu QR codes don't exist (database copy)", { skip }, () => {
  let was = true;
  before(async () => {
    was = (await prisma.businessSetting.findUniqueOrThrow({ where: { id: "default" }, select: { restaurantEnabled: true } })).restaurantEnabled;
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: false } });
  });
  after(async () => {
    await prisma.businessSetting.update({ where: { id: "default" }, data: { restaurantEnabled: was } });
    await prisma.$disconnect();
  });

  test("the actions refuse; the PNG is a 404", async () => {
    const off = { ok: false, error: "The Restaurant module is turned off." };
    assert.deepEqual(await saveMenuAddressAction({ address: "http://192.168.1.30:3000" }), off);
    assert.deepEqual(await rotateMenuQrAction({ kind: "table", id: tableId || "x" }), off);
    assert.equal((await cardPng(new Request("http://localhost/x"), { params: Promise.resolve({ kind: "table", id: tableId || "x" }) })).status, 404);
  });
});
