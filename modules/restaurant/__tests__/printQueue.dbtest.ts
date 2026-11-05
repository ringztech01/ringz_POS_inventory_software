// Part 6d Step 3 against a real database, the real hardware bridge (a child
// process, as the app server runs it) and fake ESC/POS printers on
// 127.0.0.1: KOTs to their stations' printers with copies, each ticket once;
// an unplugged printer's jobs going to the fallback (REROUTED FROM), or
// waiting and printing in order when it's back with no duplicates; retries
// then FAILED; receipts once on settle; reprints marked; device overrides;
// a job cut off mid-print; the cash drawer (Step 5) — once per cash settle,
// ahead of waiting tickets, never on the fallback, dropped when the printer
// is away 30 s, logged. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/printQueue.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:net";
import path from "node:path";
import { prisma } from "@/lib/db";
import { RECEIPT, stationRole } from "@/lib/hardware/assignments";
import { enqueuePrint } from "@/lib/hardware/printQueue";
import { openDrawer } from "@/lib/hardware/drawer";
import { tookCash } from "@/lib/hardware/drawerKick";
import { recoverInterrupted, startPrintWorker, stopPrintWorker } from "@/lib/hardware/printWorker";
import { forgetTicketLook } from "@/lib/hardware/ticketLook";
import { newQrToken } from "../lib/qrToken";
import { openTableOrder } from "../server/services/floor";
import { sendToKitchen } from "../server/services/orderFlow";
import { addLine } from "../server/services/orderLines";
import { printNewKots, printPrebill, printRestaurantReceipt, reprintKot } from "../server/services/printing";
import { settleOrder } from "../server/services/settle";
import { randomUUID } from "node:crypto";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const stamp = Date.now();
const SECRET = `pq-test-secret-${stamp}`;
const BRIDGE_PORT = 9100 + (stamp % 700) + 200;

type Fake = { server: Server; port: number; received: Buffer[]; text: () => string; reopen: () => Promise<void> };
function fake(port = 0): Promise<Fake> {
  const received: Buffer[] = [];
  const make = () =>
    createServer((socket) => {
      socket.on("error", () => {});
      socket.on("data", (data) => {
        if (data.length === 3 && data[0] === 0x10 && data[1] === 0x04) socket.write(Buffer.from([0x12]));
        else if (data.length === 3 && data[0] === 0x1d && data[1] === 0x49) socket.write(Buffer.from([0x5f, ...Buffer.from("FAKE"), 0]));
        else received.push(data);
      });
    });
  const self: Fake = {
    server: make(),
    port,
    received,
    text: () => Buffer.concat(received).toString("latin1"),
    reopen: () =>
      new Promise((resolve) => {
        self.server = make();
        self.server.listen(self.port, "127.0.0.1", () => resolve());
      }),
  };
  return new Promise((resolve) => self.server.listen(port, "127.0.0.1", () => {
    self.port = (self.server.address() as { port: number }).port;
    resolve(self);
  }));
}
const close = (f: Fake) => new Promise<void>((resolve) => f.server.close(() => resolve()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(label: string, fn: () => Promise<T | null | false>, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await sleep(200);
  }
}
const count = (text: string, needle: string) => text.split(needle).length - 1;

let bridge: ChildProcess | null = null;
let adminId = "";
let areaId = "";
const printers: Record<"kitchen" | "bar" | "receipt" | "fallback" | "serial" | "tablet", string> = { kitchen: "", bar: "", receipt: "", fallback: "", serial: "", tablet: "" };
const fakes = {} as Record<"kitchen" | "bar" | "receipt" | "fallback" | "tablet", Fake>;
const stations = { kit: "", bar: "" };
const products = { stew: "", beer: "" };
const who = () => ({ userId: adminId, deviceId: null });
const version = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).version;

async function order(lines: { productId: string; qty: number }[]) {
  const table = await prisma.table.create({ data: { name: `PQ${Math.floor(Math.random() * 1e6)}`, seats: 4, areaId, qrToken: newQrToken() }, select: { id: true } });
  const opened = await openTableOrder(table.id, adminId);
  assert.ok(opened.ok);
  for (const line of lines) for (let i = 0; i < line.qty; i++) assert.ok((await addLine({ orderId: opened.orderId, version: await version(opened.orderId), productId: line.productId, modifierIds: [], note: null })).ok);
  const sent = await sendToKitchen(opened.orderId, await version(opened.orderId), adminId);
  assert.ok(sent.ok, JSON.stringify(sent));
  return { orderId: opened.orderId, kotIds: sent.kotIds };
}
const jobsFor = (refIds: string[]) => prisma.printJob.findMany({ where: { refId: { in: refIds } }, orderBy: { createdAt: "asc" }, include: { printer: { select: { name: true } } } });
const allDone = (refIds: string[]) => until(`printed ${refIds.join(",")}`, async () => {
  const jobs = await jobsFor(refIds);
  return jobs.length > 0 && jobs.every((j) => j.status === "DONE") ? jobs : null;
});

describe("Print queue (database copy)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    process.env.BRIDGE_SECRET = SECRET;
    process.env.BRIDGE_PORT = String(BRIDGE_PORT);
    bridge = spawn(process.execPath, [path.join(process.cwd(), "desktop", "bridge", "server.ts")], { env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
    await until("bridge up", async () => (await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`, { headers: { "x-bridge-secret": SECRET } }).then((r) => r.ok).catch(() => false)));

    adminId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null, userRole: { isSystem: true, deletedAt: null } }, select: { id: true } })).id;
    const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    await prisma.businessSetting.upsert({ where: { id: "default" }, create: { id: "default", restaurantWarehouseId: warehouseId }, update: { restaurantWarehouseId: warehouseId, restaurantServiceChargePercent: 0 } });
    if (!(await prisma.customer.findFirst({ where: { isDefault: true, deletedAt: null } }))) {
      await prisma.customer.create({ data: { name: "Walk-in", email: "walk-in@example.test", phoneNumber: "0", country: "NG", city: "Lagos", address: "-", isDefault: true } });
    }
    // No other printers or jobs in the copy's way.
    await prisma.drawerEvent.deleteMany({});
    await prisma.printJob.deleteMany({});
    await prisma.deviceOverride.deleteMany({});
    await prisma.printerAssignment.deleteMany({});
    areaId = (await prisma.diningArea.create({ data: { name: `Print check ${stamp}`, warehouseId }, select: { id: true } })).id;
    stations.kit = (await prisma.kitchenStation.create({ data: { code: `PK${stamp % 1000}`, name: "PQ Kitchen", sortOrder: -2 } })).id;
    stations.bar = (await prisma.kitchenStation.create({ data: { code: `PB${stamp % 1000}`, name: "PQ Bar", sortOrder: -1 } })).id;
    const brandId = (await prisma.brand.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const unitId = (await prisma.unit.create({ data: { name: `PQu${stamp}` } })).id;
    const categoryId = (await prisma.category.create({ data: { name: `Print check ${stamp}` }, select: { id: true } })).id;
    for (const [key, stationId, price] of [["stew", stations.kit, "40.00"], ["beer", stations.bar, "10.00"]] as const) {
      const p = await prisma.product.create({ data: { name: `PQ ${key} ${stamp}`, code: `PQ-${key}-${stamp}`, price, cost: "1", categoryId, brandId, unitId, taxType: "EXCLUSIVE", productType: "MENU_ITEM", showOnMenu: true, stationId } });
      products[key] = p.id;
      await prisma.productStock.create({ data: { productId: p.id, warehouseId, quantity: 500 } });
    }
    for (const key of ["kitchen", "bar", "receipt", "fallback", "tablet"] as const) {
      fakes[key] = await fake();
      printers[key] = (await prisma.printer.create({ data: { name: `PQ ${key} printer`, connection: "NETWORK", address: `127.0.0.1:${fakes[key].port}`, paperWidth: key === "fallback" ? 58 : 80 } })).id;
    }
    printers.serial = (await prisma.printer.create({ data: { name: "PQ serial printer", connection: "SERIAL", address: "COM98" } })).id;
    await prisma.printerAssignment.createMany({
      data: [
        { role: stationRole(stations.kit), stationId: stations.kit, printerId: printers.kitchen, fallbackPrinterId: printers.fallback, copies: 2 },
        { role: stationRole(stations.bar), stationId: stations.bar, printerId: printers.bar },
        { role: RECEIPT, printerId: printers.receipt },
      ],
    });
    await startPrintWorker();
  });

  after(async () => {
    stopPrintWorker();
    bridge?.stdin?.end();
    bridge?.kill();
    for (const f of Object.values(fakes)) f.server.close();
    await prisma.$disconnect();
  });

  test("KOTs for two stations print on two printers — the kitchen's twice (copies), each counted once", async () => {
    const { kotIds } = await order([
      { productId: products.stew, qty: 2 },
      { productId: products.beer, qty: 1 },
    ]);
    assert.equal(kotIds.length, 2);
    await printNewKots(kotIds, who());
    const jobs = await allDone(kotIds);
    assert.deepEqual(jobs.map((j) => [j.printer.name, j.copies, j.type]).sort(), [["PQ bar printer", 1, "KOT"], ["PQ kitchen printer", 2, "KOT"]]);
    assert.equal(count(fakes.kitchen.text(), "PQ KITCHEN"), 2, "two copies");
    assert.ok(fakes.kitchen.text().includes(`2x  PQ stew ${stamp}`));
    assert.equal(count(fakes.bar.text(), "PQ BAR"), 1);
    assert.ok(fakes.bar.text().includes(`1x  PQ beer ${stamp}`) && !fakes.bar.text().includes("stew"));
    const kots = await prisma.kot.findMany({ where: { id: { in: kotIds } }, select: { printCount: true } });
    assert.deepEqual(kots.map((k) => k.printCount), [1, 1]);
    // Queued again (a retried action): nothing new.
    await printNewKots(kotIds, who());
    assert.equal((await jobsFor(kotIds)).length, 2);
  });

  test("the kitchen printer unplugged: its tickets go to the fallback, marked REROUTED FROM", async () => {
    await close(fakes.kitchen);
    const { kotIds } = await order([{ productId: products.stew, qty: 1 }]);
    await printNewKots(kotIds, who());
    const [job] = await allDone(kotIds);
    assert.deepEqual([job.printer.name, job.reroutedFromPrinterId], ["PQ fallback printer", printers.kitchen]);
    assert.ok(fakes.fallback.text().includes("REROUTED FROM PQ KITCHEN PRINTER"));
    assert.equal((await prisma.printer.findUniqueOrThrow({ where: { id: printers.kitchen } })).lastStatus, "OFFLINE");
  });

  test("no fallback: the tickets wait (no tries used), then print in order when it's back — none twice", async () => {
    await prisma.printerAssignment.update({ where: { businessId_role: { businessId: "default", role: stationRole(stations.kit) } }, data: { fallbackPrinterId: null } });
    const before = fakes.kitchen.received.length;
    const all: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { kotIds } = await order([{ productId: products.stew, qty: 1 }]);
      await printNewKots(kotIds, who());
      all.push(...kotIds);
    }
    const waiting = await until("waiting", async () => {
      const jobs = await jobsFor(all);
      return jobs.every((j) => j.status === "QUEUED" && j.error?.startsWith("Waiting — PQ kitchen printer is offline")) ? jobs : null;
    });
    assert.deepEqual(waiting.map((j) => j.attempts), [0, 0, 0]);
    await sleep(2000);
    assert.equal(fakes.kitchen.received.length, before, "nothing printed while it's away");
    await fakes.kitchen.reopen();
    const done = await allDone(all);
    assert.deepEqual(done.map((j) => j.printer.name), ["PQ kitchen printer", "PQ kitchen printer", "PQ kitchen printer"]);
    const refs = await prisma.kot.findMany({ where: { id: { in: all } }, orderBy: { createdAt: "asc" }, select: { number: true } });
    const text = fakes.kitchen.text();
    const positions = refs.map((k) => text.indexOf(`KOT-${String(k.number).padStart(6, "0")}`));
    assert.ok(positions.every((p) => p >= 0), "each printed");
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, "in the order they were queued");
    for (const k of refs) assert.equal(count(text, `KOT-${String(k.number).padStart(6, "0")}`), 2, "2 copies, once each");
  });

  test("a send that keeps failing: tried 3 times (2s, 8s), then FAILED with the reason", async () => {
    const queued = await enqueuePrint({ type: "TEST", printerId: printers.serial, label: "Test page · PQ serial", template: "TEST", data: { name: "PQ serial", connection: "SERIAL", address: "COM98", when: "now" } });
    assert.ok(queued.queued);
    const job = await until("failed", async () => {
      const j = await prisma.printJob.findUniqueOrThrow({ where: { id: queued.jobId } });
      return j.status === "FAILED" ? j : null;
    }, 40_000);
    assert.equal(job.attempts, 3);
    assert.ok(job.error && job.error.length > 0);
  });

  test("receipt on settle: once per sale; Print again is a marked reprint; a device's own printer", async () => {
    const { orderId } = await order([{ productId: products.beer, qty: 1 }]);
    const settled = await settleOrder({ orderId, version: await version(orderId), payments: [{ paymentType: "CASH", amount: "10" }], tip: "0", idempotencyKey: randomUUID() }, adminId);
    assert.ok(settled.ok, JSON.stringify(settled));
    const first = await printRestaurantReceipt(settled.saleId, who(), false);
    const again = await printRestaurantReceipt(settled.saleId, who(), false);
    assert.ok(first?.queued && again?.queued && first.jobId === again.jobId, "once");
    await allDone([settled.saleId]);
    assert.equal(count(fakes.receipt.text(), "*** REPRINT ***"), 0);
    const reprint = await printRestaurantReceipt(settled.saleId, who(), true);
    assert.ok(reprint?.queued && reprint.jobId !== first.jobId);
    await allDone([settled.saleId]);
    assert.equal(count(fakes.receipt.text(), "*** REPRINT ***"), 1);
    // Cashier tablet 2 prints its receipts on its own printer.
    const device = await prisma.device.create({ data: { id: randomUUID(), name: "PQ tablet" } });
    await prisma.deviceOverride.create({ data: { deviceId: device.id, role: RECEIPT, printerId: printers.tablet } });
    const own = await printRestaurantReceipt(settled.saleId, { userId: adminId, deviceId: device.id }, true);
    assert.ok(own?.queued && own.printer === "PQ tablet printer");
    await allDone([settled.saleId]);
    assert.ok(fakes.tablet.text().includes("*** REPRINT ***"));
  });

  test("pre-bill on the receipt printer (none of its own); a KOT reprint says REPRINT #2; no printer → not queued", async () => {
    const { orderId, kotIds } = await order([{ productId: products.beer, qty: 2 }]);
    const pre = await printPrebill(orderId, who());
    assert.ok(pre?.queued && pre.printer === "PQ receipt printer");
    await allDone([orderId]);
    assert.ok(fakes.receipt.text().includes("*** NOT A RECEIPT ***"));
    await printNewKots(kotIds, who());
    await allDone(kotIds);
    const re = await reprintKot(kotIds[0], who());
    assert.ok(re?.queued);
    await allDone(kotIds);
    assert.ok(fakes.bar.text().includes("*** REPRINT #2 ***"));
    assert.deepEqual(await enqueuePrint({ type: "KOT", role: stationRole("no-such-station"), label: "x", template: "KOT", data: {} }), { queued: false, reason: "NO_PRINTER" });
  });

  test("the business look (Settings › Ticket templates): header, footer, logo, QR on receipts; prices on KOTs", async () => {
    await prisma.businessSetting.update({
      where: { id: "default" },
      data: {
        printHeader: "PQ Mama Put\n12 Allen Ave",
        printFooter: "PQ thanks you",
        printLogo: true,
        printLogoWidth: 16,
        printLogoHeight: 2,
        printLogoData: Buffer.from([0xff, 0xff, 0x81, 0x81]),
        printQr: true,
        printQrText: "https://pq.test/r",
        printKotPrices: true,
      },
    });
    forgetTicketLook();
    try {
      const { orderId, kotIds } = await order([{ productId: products.beer, qty: 2 }]);
      const before = fakes.receipt.received.length;
      const pre = await printPrebill(orderId, who());
      assert.ok(pre?.queued);
      await allDone([orderId]);
      const printed = Buffer.concat(fakes.receipt.received.slice(before));
      const text = printed.toString("latin1");
      assert.ok(text.includes("PQ Mama Put") && text.includes("12 Allen Ave") && text.includes("PQ thanks you"));
      assert.ok(printed.includes(Buffer.from([0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0xff, 0xff, 0x81, 0x81])), "the logo, as saved");
      assert.ok(printed.indexOf(Buffer.from([0x1d, 0x76, 0x30])) !== printed.lastIndexOf(Buffer.from([0x1d, 0x76, 0x30])), "and the QR code");
      const barBefore = fakes.bar.received.length;
      await printNewKots(kotIds, who());
      await allDone(kotIds);
      const kot = Buffer.concat(fakes.bar.received.slice(barBefore)).toString("latin1");
      assert.ok(kot.includes("N20.00"), "the price on the KOT");
      assert.ok(kot.includes("PQ Mama Put") && !kot.includes("PQ thanks you"), "the name, not the footer");
    } finally {
      await prisma.businessSetting.update({ where: { id: "default" }, data: { printHeader: null, printFooter: null, printLogo: false, printLogoWidth: null, printLogoHeight: null, printLogoData: null, printQr: false, printQrText: null, printKotPrices: false } });
      forgetTicketLook();
    }
  });

  // ---- Step 5: the cash drawer (on the receipt printer, pin 5)
  const KICK = Buffer.from([0x1b, 0x70, 1, 25, 250]);
  const kicks = (f: Fake, from = 0) => {
    const all = Buffer.concat(f.received.slice(from));
    let n = 0;
    for (let i = all.indexOf(KICK); i >= 0; i = all.indexOf(KICK, i + 1)) n++;
    return n;
  };
  const jobDone = (id: string) => until(`job ${id} done`, async () => (await prisma.printJob.findUniqueOrThrow({ where: { id } })).status === "DONE");

  test("drawer: a cash settle opens it once — a retried settle doesn't open it again; logged with the sale", async () => {
    await prisma.printer.update({ where: { id: printers.receipt }, data: { openDrawer: true, drawerPin: 5 } });
    const { orderId } = await order([{ productId: products.beer, qty: 1 }]);
    const key = randomUUID();
    const settled = await settleOrder({ orderId, version: await version(orderId), payments: [{ paymentType: "CASH", amount: "10" }], tip: "0", idempotencyKey: key }, adminId);
    assert.ok(settled.ok, JSON.stringify(settled));
    assert.equal(tookCash([{ paymentType: "CASH", amount: "10" }]), true);
    const before = fakes.receipt.received.length;
    const input = { reason: "CASH_SALE" as const, userId: adminId, deviceId: null, refId: settled.saleId, refLabel: settled.reference, dedupeKey: `DRAWER:SETTLE:${key}` };
    const first = await openDrawer(input);
    const retry = await openDrawer(input);
    assert.ok(first.sent && retry.sent && first.jobId === retry.jobId && retry.again, "the same kick");
    assert.equal(first.printer, "PQ receipt printer");
    await jobDone(first.jobId);
    await sleep(500);
    assert.equal(kicks(fakes.receipt, before), 1, "opened once");
    const events = await prisma.drawerEvent.findMany({ where: { refId: settled.saleId } });
    assert.equal(events.length, 1);
    assert.deepEqual([events[0].reason, events[0].refLabel, events[0].userId, events[0].printerId], ["CASH_SALE", settled.reference, adminId, printers.receipt]);
  });

  test("drawer: it goes ahead of a ticket waiting for its retry; a device on a printer without a drawer has none", async () => {
    const stuck = await prisma.printJob.create({ data: { printerId: printers.receipt, type: "TEST", label: "PQ stuck ticket", template: "TEST", data: { name: "x", connection: "NETWORK", address: "x", when: "now" }, nextAttemptAt: new Date(Date.now() + 120_000) } });
    try {
      const before = fakes.receipt.received.length;
      const opened = await openDrawer({ reason: "MANUAL", note: "Give change", userId: adminId, deviceId: null });
      assert.ok(opened.sent);
      await jobDone(opened.jobId);
      assert.equal(kicks(fakes.receipt, before), 1);
      assert.equal((await prisma.printJob.findUniqueOrThrow({ where: { id: stuck.id } })).status, "QUEUED", "the ticket still waits its turn");
      const event = await prisma.drawerEvent.findUniqueOrThrow({ where: { printJobId: opened.jobId } });
      assert.deepEqual([event.reason, event.note], ["MANUAL", "Give change"]);
    } finally {
      await prisma.printJob.update({ where: { id: stuck.id }, data: { status: "CANCELLED" } });
    }
    const device = await prisma.device.create({ data: { id: randomUUID(), name: "PQ no-drawer till" } });
    await prisma.deviceOverride.create({ data: { deviceId: device.id, role: RECEIPT, printerId: printers.bar } });
    assert.deepEqual(await openDrawer({ reason: "CASH_SALE", userId: adminId, deviceId: device.id }), { sent: false, reason: "NO_DRAWER" });
    assert.deepEqual(await openDrawer({ reason: "TEST", userId: adminId, deviceId: null, printerId: printers.bar }), { sent: false, reason: "NO_DRAWER" });
  });

  test("drawer: printer unplugged — the kick waits, never goes to the fallback, is dropped after 30 s and not sent when it's back", async () => {
    const role = { businessId_role: { businessId: "default", role: RECEIPT } };
    await prisma.printerAssignment.update({ where: role, data: { fallbackPrinterId: printers.fallback } });
    await close(fakes.receipt);
    const fallbackBefore = fakes.fallback.received.length;
    try {
      const opened = await openDrawer({ reason: "CASH_REFUND", userId: adminId, deviceId: null, refLabel: "SR_PQ", dedupeKey: `DRAWER:REFUND:${randomUUID()}` });
      assert.ok(opened.sent);
      await sleep(4000);
      const waiting = await prisma.printJob.findUniqueOrThrow({ where: { id: opened.jobId } });
      assert.deepEqual([waiting.status, waiting.printerId], ["QUEUED", printers.receipt], "waiting on its own printer");
      // 30 s on (moved back rather than waited for): dropped.
      await prisma.printJob.update({ where: { id: opened.jobId }, data: { createdAt: new Date(Date.now() - 31_000) } });
      const dropped = await until("dropped", async () => {
        const j = await prisma.printJob.findUniqueOrThrow({ where: { id: opened.jobId } });
        return j.status === "CANCELLED" ? j : null;
      });
      assert.match(dropped.error ?? "", /^Not opened — the printer didn't take it within 30 seconds/);
      const before = fakes.receipt.received.length;
      await fakes.receipt.reopen();
      await sleep(3500);
      assert.equal(kicks(fakes.receipt, before), 0, "never sent late");
      assert.equal(kicks(fakes.fallback, fallbackBefore), 0, "never on the fallback");
    } finally {
      await prisma.printerAssignment.update({ where: role, data: { fallbackPrinterId: null } });
    }
  });

  test("a job cut off mid-print is FAILED on restart — never printed again unseen", async () => {
    const job = await prisma.printJob.create({ data: { printerId: printers.bar, type: "TEST", label: "cut off", template: "TEST", data: {}, status: "PRINTING" } });
    assert.ok((await recoverInterrupted()) >= 1);
    const after = await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(after.status, "FAILED");
    assert.match(after.error ?? "", /^Interrupted while printing/);
  });
});
