// Part 6d Step 7 against a real database and a FAKE hardware bridge (an
// HTTP server here, so the tests decide what the "hardware" does): one slow
// printer never holds up another; a replugged USB printer whose Windows
// queue came back as "(Copy 1)" is found again by the worker and prints on
// under the same assignment; a USB device on another port (new instance id)
// is matched by its ids; a network printer's new IP is suggested from a
// scan by MAC — never taken by itself. Needs a throwaway copy:
//
//   RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/plugAndPlay.dbtest.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { prisma } from "@/lib/db";
import { RECEIPT } from "@/lib/hardware/assignments";
import { enqueuePrint } from "@/lib/hardware/printQueue";
import { startPrintWorker, stopPrintWorker } from "@/lib/hardware/printWorker";
import { redetectLocal, suggestMoved } from "@/lib/hardware/redetect";
import type { DiscoveredPrinter } from "@/desktop/bridge/types.ts";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
const enabled = process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

const stamp = Date.now();
const SECRET = `pp-test-secret-${stamp}`;
const PORT = 9100 + (stamp % 700) + 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(label: string, fn: () => Promise<T | null | false>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await sleep(150);
  }
}

// The fake bridge: what each address answers, how long a print takes there,
// and what discovery sees.
const hw = {
  offline: new Set<string>(),
  slow: new Map<string, number>(),
  printed: [] as { address: string; at: number }[],
  local: [] as DiscoveredPrinter[],
  lan: [] as DiscoveredPrinter[],
};
let server: Server;
const json = (res: import("node:http").ServerResponse, body: unknown) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
function fakeBridge(): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      if (req.headers["x-bridge-secret"] !== SECRET) {
        res.writeHead(401);
        return res.end("{}");
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const data = body ? JSON.parse(body) : {};
        if (req.url === "/health") return json(res, { ok: true, version: 1, platform: "test", pid: 1, uptimeSec: 1 });
        if (req.url === "/status") {
          const statuses = Object.fromEntries((data.printers as { id: string; address: string }[]).map((p) => [p.id, hw.offline.has(p.address) ? { status: "OFFLINE", detail: "Unplugged" } : { status: "ONLINE", detail: "Ready" }]));
          return json(res, { ok: true, statuses });
        }
        if (req.url === "/print") {
          if (hw.offline.has(data.address)) return json(res, { ok: false, error: "Unplugged" });
          await sleep(hw.slow.get(data.address) ?? 0);
          hw.printed.push({ address: data.address, at: Date.now() });
          return json(res, { ok: true, bytes: 1 });
        }
        if (req.url?.startsWith("/discover")) {
          const network = !req.url.includes("network=0");
          return json(res, { ok: true, printers: network ? [...hw.local, ...hw.lan] : hw.local, errors: [], subnets: [], tookMs: 1 });
        }
        res.writeHead(404);
        res.end("{}");
      });
    });
    s.listen(PORT, "127.0.0.1", () => resolve(s));
  });
}

const found = (p: Partial<DiscoveredPrinter> & Pick<DiscoveredPrinter, "connection" | "address" | "name">): DiscoveredPrinter => ({ id: `${p.connection}:${p.address}`, model: null, status: "ONLINE", statusDetail: null, identity: {}, ...p });
const testJob = (printerId: string, label: string) => enqueuePrint({ type: "TEST", printerId, label, template: "TEST", data: { name: label, connection: "NETWORK", address: "x", when: "now" } });
const jobOf = (id: string) => prisma.printJob.findUniqueOrThrow({ where: { id } });

describe("Plug and play (database copy, fake bridge)", { skip: enabled ? false : "set RESTAURANT_DB_TEST=1 and use a *_restaurant_check database" }, () => {
  before(async () => {
    process.env.BRIDGE_SECRET = SECRET;
    process.env.BRIDGE_PORT = String(PORT);
    server = await fakeBridge();
    await prisma.drawerEvent.deleteMany({});
    await prisma.printJob.deleteMany({});
    await prisma.deviceOverride.deleteMany({});
    await prisma.printerAssignment.deleteMany({});
    await startPrintWorker();
  });

  after(async () => {
    stopPrintWorker();
    server.close();
    await prisma.$disconnect();
  });

  test("a slow printer holds up only its own jobs — the other printer prints at once", async () => {
    const slow = await prisma.printer.create({ data: { name: `PP slow ${stamp}`, connection: "NETWORK", address: "10.9.9.1:9100" } });
    const fast = await prisma.printer.create({ data: { name: `PP fast ${stamp}`, connection: "NETWORK", address: "10.9.9.2:9100" } });
    hw.slow.set("10.9.9.1:9100", 6000);
    const a = await testJob(slow.id, "slow one");
    await sleep(300);
    const b = await testJob(fast.id, "fast one");
    assert.ok(a.queued && b.queued);
    const fastDone = await until("fast printed", async () => ((await jobOf(b.jobId)).status === "DONE" ? Date.now() : null), 4000);
    assert.equal((await jobOf(a.jobId)).status, "PRINTING", "the slow one is still going");
    await until("slow printed", async () => (await jobOf(a.jobId)).status === "DONE", 15_000);
    const order = hw.printed.filter((p) => p.address.startsWith("10.9.9.")).map((p) => p.address);
    assert.deepEqual(order, ["10.9.9.2:9100", "10.9.9.1:9100"], "the fast printer didn't wait");
    assert.ok(fastDone > 0);
  });

  test("replugged: the Windows queue came back as “(Copy 1)” — found again, same assignment, the waiting receipt prints there", async () => {
    const name = `PP Receipt ${stamp}`;
    const p = await prisma.printer.create({ data: { name: "PP receipt printer", connection: "OS", address: name, model: "EPSON TM-T20II Receipt", identity: { osName: name } } });
    await prisma.printerAssignment.create({ data: { role: RECEIPT, printerId: p.id } });
    hw.offline.add(name);
    hw.local = [found({ connection: "OS", name: `${name} (Copy 1)`, address: "USB002", model: "EPSON TM-T20II Receipt", identity: { osName: `${name} (Copy 1)` } })];
    const queued = await enqueuePrint({ type: "TEST", role: RECEIPT, label: "receipt after replug", template: "TEST", data: { name: "r", connection: "OS", address: "x", when: "now" } });
    assert.ok(queued.queued);
    const done = await until("printed after the re-detect", async () => {
      const j = await jobOf(queued.jobId);
      return j.status === "DONE" ? j : null;
    });
    assert.equal(done.printerId, p.id, "the same printer row");
    const after = await prisma.printer.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(after.address, `${name} (Copy 1)`);
    assert.deepEqual(after.identity, { osName: `${name} (Copy 1)` });
    assert.deepEqual((await prisma.printerAssignment.findMany({ where: { role: RECEIPT } })).map((a) => a.printerId), [p.id], "assignment kept");
    assert.ok(hw.printed.some((x) => x.address === `${name} (Copy 1)`), "printed on the queue it came back as");
  });

  test("USB in another port (a new instance id): matched by vendor / product id; two candidates or a taken one: no match", async () => {
    const p = await prisma.printer.create({ data: { name: `PP usb ${stamp}`, connection: "USB", address: "USB\\VID_0416&PID_5011\\5&2B6C0F&0&2", identity: { vendorId: "0416", productId: "5011" } } });
    const moved = await redetectLocal([p.id], {
      force: true,
      discover: async () => ({ ok: true, printers: [found({ connection: "USB", name: "USB printer", address: "USB\\VID_0416&PID_5011\\5&2B6C0F&0&4", identity: { vendorId: "0416", productId: "5011" } })] }),
    });
    assert.deepEqual(moved.map((m) => [m.to, m.by]), [["USB\\VID_0416&PID_5011\\5&2B6C0F&0&4", "usb"]]);
    // Two identical printers plugged in: it's never a guess.
    const q = await prisma.printer.create({ data: { name: `PP usb2 ${stamp}`, connection: "USB", address: "USB\\VID_0416&PID_5011\\old", identity: { vendorId: "0416", productId: "5011" } } });
    const twin = (n: number) => found({ connection: "USB", name: "USB printer", address: `USB\\VID_0416&PID_5011\\new${n}`, identity: { vendorId: "0416", productId: "5011" } });
    assert.deepEqual(await redetectLocal([q.id], { force: true, discover: async () => ({ ok: true, printers: [twin(1), twin(2)] }) }), []);
    assert.equal((await prisma.printer.findUniqueOrThrow({ where: { id: q.id } })).address, "USB\\VID_0416&PID_5011\\old", "unchanged");
  });

  test("a network printer's new IP: suggested from a LAN scan by its MAC — not taken by itself; another printer's address is never suggested", async () => {
    const p = await prisma.printer.create({ data: { name: `PP kitchen net ${stamp}`, connection: "NETWORK", address: "10.8.8.50:9100", model: "TM-T88V", identity: { mac: "00:26:AB:12:34:56" } } });
    hw.lan = [
      found({ connection: "NETWORK", name: "Printer at 10.8.8.77", address: "10.8.8.77:9100", model: "TM-T88V", identity: { mac: "00-26-ab-12-34-56" } }),
      found({ connection: "NETWORK", name: "Printer at 10.8.8.78", address: "10.8.8.78:9100", model: "TM-T88V", identity: { mac: "00:26:AB:99:99:99" } }),
    ];
    const s = await suggestMoved(p.id);
    assert.deepEqual(s, { ok: true, suggestion: { address: "10.8.8.77:9100", by: "mac", model: "TM-T88V" } });
    assert.equal((await prisma.printer.findUniqueOrThrow({ where: { id: p.id } })).address, "10.8.8.50:9100", "only a suggestion");
    // That address belongs to another saved printer: not suggested.
    await prisma.printer.create({ data: { name: `PP other ${stamp}`, connection: "NETWORK", address: "10.8.8.77:9100" } });
    assert.deepEqual(await suggestMoved(p.id), { ok: true, suggestion: null });
  });
});
