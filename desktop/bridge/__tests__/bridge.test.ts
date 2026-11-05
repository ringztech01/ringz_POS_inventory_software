// The hardware bridge's pure rules. Runs on Node directly (type stripping),
// as the bridge itself does:  node --test desktop/bridge/__tests__/bridge.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoopback, refusal, secretMatches } from "../auth.ts";
import { MODEL_QUERY, readModel, readStatus, STATUS_PAPER, STATUS_PRINTER } from "../escposStatus.ts";
import { macFromArp, parseTarget, subnetsFrom } from "../discoverNetwork.ts";
import { lpstatPrinters, rowsOf, usbIds, windowsPrinters, windowsSerialPorts, windowsUsbDevices } from "../parse.ts";
import { encodeGet, readGetResponse, SYS_DESCR } from "../snmp.ts";

test("only this machine, with the secret", () => {
  const secret = "s3cret-s3cret-s3cret";
  assert.equal(refusal("127.0.0.1", secret, secret), null);
  assert.equal(refusal("::1", secret, secret), null);
  assert.equal(refusal("::ffff:127.0.0.1", secret, secret), null);
  assert.deepEqual(refusal("192.168.1.20", secret, secret), { status: 403, error: "The bridge only answers this machine." });
  assert.deepEqual(refusal("127.0.0.1", "wrong", secret), { status: 401, error: "Wrong or missing bridge secret." });
  assert.equal(secretMatches(undefined, secret), false);
  assert.equal(secretMatches([secret], secret), false);
  assert.equal(secretMatches(secret, ""), false);
  assert.equal(isLoopback(undefined), false);
});

test("ESC/POS real-time status: the bytes, and reading the replies", () => {
  assert.deepEqual([...STATUS_PRINTER], [0x10, 0x04, 0x01]);
  assert.deepEqual([...STATUS_PAPER], [0x10, 0x04, 0x04]);
  assert.deepEqual([...MODEL_QUERY], [0x1d, 0x49, 0x43]);
  assert.deepEqual(readStatus(0x12, 0x12), { status: "ONLINE", detail: null });
  assert.deepEqual(readStatus(0x1a, 0x12), { status: "OFFLINE", detail: "Printer reports offline (cover open or error)" });
  assert.deepEqual(readStatus(0x12, 0x72), { status: "PAPER_OUT", detail: "Paper out" });
  assert.deepEqual(readStatus(0x12, 0x1e), { status: "ONLINE", detail: "Paper low" });
  // Paper out wins over offline (an empty printer goes offline too).
  assert.equal(readStatus(0x1a, 0x72).status, "PAPER_OUT");
  assert.deepEqual(readStatus(null, null), { status: "UNKNOWN", detail: "No status reply" });
  // Not a status byte (a non-ESC/POS device echoing): ignored.
  assert.deepEqual(readStatus(0x41, 0xff), { status: "UNKNOWN", detail: "No status reply" });
  assert.equal(readModel(Uint8Array.from([0x5f, ...Buffer.from("TM-T20II"), 0])), "TM-T20II");
  assert.equal(readModel(Uint8Array.from([0x41, 0x42, 0x43])), null);
  assert.equal(readModel(new Uint8Array()), null);
});

test("Windows printers: Win32_Printer rows → OS printers with status", () => {
  const rows = [
    { Name: "EPSON TM-T20II Receipt", PortName: "USB001", DriverName: "EPSON TM-T20II Receipt5", WorkOffline: false, PrinterStatus: 3, DetectedErrorState: 2 },
    { Name: "Kitchen", PortName: "IP_192.168.1.60", DriverName: "Generic / Text Only", WorkOffline: true, PrinterStatus: 3, DetectedErrorState: 0 },
    { Name: "Bar", PortName: "USB002", DriverName: "POS-80", WorkOffline: false, PrinterStatus: 1, DetectedErrorState: 4 },
    { Name: "Office", PortName: "WSD-1", DriverName: "HP LaserJet", WorkOffline: false, PrinterStatus: 7, DetectedErrorState: 9 },
    { Name: "", PortName: "x" },
  ];
  assert.deepEqual(
    windowsPrinters(rows).map((p) => [p.id, p.connection, p.address, p.model, p.status, p.statusDetail]),
    [
      ["os:EPSON TM-T20II Receipt", "OS", "USB001", "EPSON TM-T20II Receipt5", "ONLINE", null],
      ["os:Kitchen", "OS", "IP_192.168.1.60", "Generic / Text Only", "OFFLINE", "Work offline"],
      ["os:Bar", "OS", "USB002", "POS-80", "PAPER_OUT", "Paper out"],
      ["os:Office", "OS", "WSD-1", "HP LaserJet", "OFFLINE", "Offline"],
    ],
  );
  // One printer: ConvertTo-Json gives an object, not an array.
  assert.equal(windowsPrinters(rows[0]).length, 1);
  assert.deepEqual(rowsOf(null), []);
  assert.deepEqual(windowsPrinters(rows)[0].identity, { osName: "EPSON TM-T20II Receipt" });
});

test("raw USB printing devices: vendor / product ids and the serial (Step 7's identity)", () => {
  assert.deepEqual(usbIds("USB\\VID_0416&PID_5011\\A1B2C3D4"), { vendorId: "0416", productId: "5011", serial: "A1B2C3D4" });
  // No serial reported: Windows' instance id isn't one.
  assert.deepEqual(usbIds("USB\\VID_04b8&PID_0e15\\5&2B6C0F&0&2"), { vendorId: "04B8", productId: "0E15" });
  assert.deepEqual(usbIds("ROOT\\PRINTER\\0000"), {});
  const [device] = windowsUsbDevices([{ Name: "USB Printing Support", DeviceID: "USB\\VID_0416&PID_5011\\A1B2C3D4", Status: "OK", Manufacturer: "(Standard USB Host Controller)" }]);
  assert.deepEqual(
    [device.id, device.name, device.connection, device.model, device.status, device.identity],
    ["usb:USB\\VID_0416&PID_5011\\A1B2C3D4", "USB printer 0416:5011", "USB", null, "ONLINE", { vendorId: "0416", productId: "5011", serial: "A1B2C3D4" }],
  );
  assert.equal(windowsUsbDevices({ Name: "POS58", DeviceID: "USB\\VID_0483&PID_5743\\X", Status: "Unknown" })[0].status, "OFFLINE");
});

test("serial ports: named ones and .NET-only ones, in port order", () => {
  const ports = windowsSerialPorts([{ DeviceID: "COM3", Name: "Communications Port (COM3)" }], ["COM3", "COM10", "COM4"]);
  assert.deepEqual(
    ports.map((p) => [p.id, p.name, p.status]),
    [
      ["serial:COM3", "Communications Port (COM3)", "UNKNOWN"],
      ["serial:COM4", "Serial port COM4", "UNKNOWN"],
      ["serial:COM10", "Serial port COM10", "UNKNOWN"],
    ],
  );
  assert.deepEqual(windowsSerialPorts(null, "COM1").map((p) => p.id), ["serial:COM1"]);
});

test("CUPS (Linux / macOS): lpstat -v and -p", () => {
  const devices = "device for TM20: usb://EPSON/TM-T20II?serial=X4FJ012345\ndevice for Bar: socket://192.168.1.61:9100\n";
  const states = "printer TM20 is idle.  enabled since Thu 05 Nov 2026\nprinter Bar disabled since Thu 05 Nov 2026 -\n";
  assert.deepEqual(
    lpstatPrinters(devices, states).map((p) => [p.id, p.address, p.model, p.status, p.identity]),
    [
      ["os:TM20", "usb://EPSON/TM-T20II?serial=X4FJ012345", "EPSON TM-T20II", "ONLINE", { osName: "TM20", serial: "X4FJ012345" }],
      ["os:Bar", "socket://192.168.1.61:9100", null, "OFFLINE", { osName: "Bar" }],
    ],
  );
});

test("the LAN: /24s around this machine, loopback and link-local skipped", () => {
  const nic = (address: string, internal = false) => ({ address, netmask: "255.255.255.0", family: "IPv4" as const, mac: "00:00:00:00:00:00", internal, cidr: `${address}/24` });
  const subnets = subnetsFrom({ eth0: [nic("192.168.1.20")], lo: [nic("127.0.0.1", true)], wifi: [nic("169.254.3.4"), nic("10.0.5.7")] });
  assert.deepEqual(subnets.map((s) => [s.cidr, s.hosts.length, s.hosts.includes("192.168.1.20") || s.hosts.includes("10.0.5.7")]), [
    ["192.168.1.0/24", 253, false],
    ["10.0.5.0/24", 253, false],
  ]);
  assert.equal(subnets[0].hosts[0], "192.168.1.1");
});

test("MAC from the ARP table (Windows and Linux)", () => {
  const win = "Interface: 192.168.1.20 --- 0x5\n  Internet Address      Physical Address      Type\n  192.168.1.60          00-11-22-aa-bb-cc     dynamic\n  192.168.1.255         ff-ff-ff-ff-ff-ff     static\n";
  assert.equal(macFromArp(win, "192.168.1.60"), "00:11:22:AA:BB:CC");
  assert.equal(macFromArp(win, "192.168.1.255"), null);
  assert.equal(macFromArp("192.168.1.61 dev eth0 lladdr 00:11:22:aa:bb:dd REACHABLE", "192.168.1.61"), "00:11:22:AA:BB:DD");
  assert.equal(macFromArp(win, "192.168.1.6"), null, "not a prefix match");
});

test("the manual IP: host[:port]", () => {
  assert.deepEqual(parseTarget("192.168.1.50"), { host: "192.168.1.50", port: 9100 });
  assert.deepEqual(parseTarget(" 192.168.1.50:9101 "), { host: "192.168.1.50", port: 9101 });
  assert.deepEqual(parseTarget("kitchen-printer.local"), { host: "kitchen-printer.local", port: 9100 });
  assert.equal(parseTarget("192.168.1.50:0"), null);
  assert.equal(parseTarget("http://x"), null);
  assert.equal(parseTarget("a b"), null);
  assert.equal(parseTarget("-bad"), null);
});

test("SNMP v1 GET: the request bytes, and reading a reply", () => {
  const request = encodeGet(SYS_DESCR, 42);
  // SEQUENCE, version 0, community "public", GetRequest.
  assert.deepEqual([...request.subarray(0, 2)], [0x30, request.length - 2]);
  assert.deepEqual([...request.subarray(2, 13)], [0x02, 0x01, 0x00, 0x04, 0x06, ...Buffer.from("public")]);
  assert.equal(request[13], 0xa0);
  // OID 1.3.6.1.2.1.1.1.0 → 2b 06 01 02 01 01 01 00.
  assert.ok(Buffer.from(request).includes(Buffer.from([0x06, 0x08, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00])));
  // A GetResponse: the same, tag a2, the value an OCTET STRING.
  const value = Buffer.from("EPSON TM-T88V");
  const oid = [0x06, 0x08, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00];
  const varbind = [0x30, oid.length + 2 + value.length, ...oid, 0x04, value.length, ...value];
  const pduBody = [0x02, 0x01, 42, 0x02, 0x01, 0x00, 0x02, 0x01, 0x00, 0x30, varbind.length, ...varbind];
  const body = [0x02, 0x01, 0x00, 0x04, 0x06, ...Buffer.from("public"), 0xa2, pduBody.length, ...pduBody];
  const reply = Uint8Array.from([0x30, body.length, ...body]);
  assert.equal(readGetResponse(reply, 42), "EPSON TM-T88V");
  assert.equal(readGetResponse(reply, 43), null, "another request's answer");
  const failed = Uint8Array.from(reply);
  // error-status (after the PDU's tag + length and its 3-byte request id): noSuchName.
  failed[reply.indexOf(0xa2) + 2 + 3 + 2] = 2;
  assert.equal(readGetResponse(failed, 42), null);
  assert.equal(readGetResponse(Uint8Array.from([0x30, 0x05, 0x02]), 42), null, "truncated");
});

// ---- Printing and status against a fake network printer (127.0.0.1)

import { createServer, type AddressInfo, type Server } from "node:net";
import { printRaw } from "../print.ts";
import { probePrinter } from "../discoverNetwork.ts";

// A fake ESC/POS printer: keeps what it's sent; answers DLE EOT 1 / 4 with
// the given status bytes.
function fakePrinter(printerByte: number, paperByte: number): Promise<{ server: Server; port: number; received: () => Buffer }> {
  const chunks: Buffer[] = [];
  const server = createServer((socket) => {
    socket.on("data", (data) => {
      chunks.push(data);
      if (data.length === 3 && data[0] === 0x10 && data[1] === 0x04) socket.write(Buffer.from([data[2] === 1 ? printerByte : paperByte]));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port, received: () => Buffer.concat(chunks) })));
}

test("raw printing to a network printer: every byte arrives, then the connection closes", async () => {
  const fake = await fakePrinter(0x12, 0x12);
  try {
    const job = Uint8Array.from([0x1b, 0x40, ...Buffer.from("Hello kitchen\n"), 0x1d, 0x56, 66, 3]);
    await printRaw({ connection: "NETWORK", address: `127.0.0.1:${fake.port}` }, job);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual([...fake.received()], [...job]);
  } finally {
    fake.server.close();
  }
  await assert.rejects(printRaw({ connection: "NETWORK", address: `127.0.0.1:${fake.port}` }, Uint8Array.from([1])), /refused the connection|Can't reach/);
  await assert.rejects(printRaw({ connection: "NETWORK", address: "not a host!" }, Uint8Array.from([1])), /isn't an IP address/);
  await assert.rejects(printRaw({ connection: "NETWORK", address: "127.0.0.1" }, new Uint8Array()), /Nothing to print/);
});

test("probing a printer: its real-time status (paper out, offline) — and nothing printed", async () => {
  const empty = await fakePrinter(0x12, 0x72);
  const offline = await fakePrinter(0x1a, 0x12);
  try {
    const a = await probePrinter("127.0.0.1", empty.port);
    assert.deepEqual([a.connection, a.address, a.status, a.statusDetail], ["NETWORK", `127.0.0.1:${empty.port}`, "PAPER_OUT", "Paper out"]);
    const b = await probePrinter("127.0.0.1", offline.port);
    assert.equal(b.status, "OFFLINE");
    // Only the non-printing queries were sent.
    assert.deepEqual([...empty.received()], [0x10, 0x04, 0x01, 0x10, 0x04, 0x04, 0x1d, 0x49, 0x43]);
  } finally {
    empty.server.close();
    offline.server.close();
  }
  const gone = await probePrinter("127.0.0.1", empty.port, 500);
  assert.equal(gone.status, "OFFLINE");
});
