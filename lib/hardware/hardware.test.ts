// Run with: npx tsx --test lib/hardware/hardware.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { missingRoles, PREBILL, RECEIPT, REPORTS, resolvePrinter, stationOf, stationRole, type Assignment } from "./assignments";
import { decodeByte, encoderFor } from "./codePages";
import { DRAWER_TTL_MS, drawerBytes, drawerOutcome, tookCash } from "./drawerKick";
import { columns, encodeText, EscPos, lineWidth } from "./escpos";
import { previewEscPos, previewText } from "./escposPreview";
import { blackAt, qrRaster, rasterCommand, toRaster } from "./raster";
import { testPrintBytes } from "./testPrint";
import { assignmentsSchema, deviceSchema, printerSchema } from "../validations/printer";
import { drawerOpenSchema } from "../validations/drawer";

const kitchen = stationRole("kit1");
const bar = stationRole("bar1");
const assignments: Assignment[] = [
  { role: kitchen, printerId: "p-kitchen", fallbackPrinterId: "p-receipt", copies: 2 },
  { role: bar, printerId: "p-bar", fallbackPrinterId: null, copies: 1 },
  { role: RECEIPT, printerId: "p-receipt", fallbackPrinterId: "p-receipt2", copies: 1 },
];

test("roles: each station to its printer with copies and fallback; Bar is a station", () => {
  assert.deepEqual(resolvePrinter(kitchen, null, assignments, []), { printerId: "p-kitchen", fallbackPrinterId: "p-receipt", copies: 2, via: "role" });
  assert.deepEqual(resolvePrinter(bar, null, assignments, []), { printerId: "p-bar", fallbackPrinterId: null, copies: 1, via: "role" });
  assert.equal(stationOf(kitchen), "kit1");
  assert.equal(stationOf(RECEIPT), null);
  assert.equal(resolvePrinter(stationRole("nope"), null, assignments, []), null);
});

test("pre-bill defaults to the receipt printer; reports need their own", () => {
  assert.deepEqual(resolvePrinter(PREBILL, null, assignments, []), { printerId: "p-receipt", fallbackPrinterId: "p-receipt2", copies: 1, via: "receipt" });
  const own = [...assignments, { role: PREBILL, printerId: "p-pre", fallbackPrinterId: null, copies: 1 }];
  assert.equal(resolvePrinter(PREBILL, null, own, [])?.printerId, "p-pre");
  assert.equal(resolvePrinter(REPORTS, null, assignments, []), null);
});

test("a device override: its own printer, the role's fallback still there (not itself)", () => {
  const overrides = [{ deviceId: "tablet-2", role: RECEIPT, printerId: "p-receipt2" }];
  assert.deepEqual(resolvePrinter(RECEIPT, "tablet-2", assignments, overrides), { printerId: "p-receipt2", fallbackPrinterId: null, copies: 1, via: "device" });
  assert.equal(resolvePrinter(RECEIPT, "tablet-1", assignments, overrides)?.printerId, "p-receipt");
  const other = [{ deviceId: "tablet-3", role: RECEIPT, printerId: "p-x" }];
  assert.equal(resolvePrinter(RECEIPT, "tablet-3", assignments, other)?.fallbackPrinterId, "p-receipt2");
  // Pre-bill override with no pre-bill role: falls back via the receipt's.
  assert.equal(resolvePrinter(PREBILL, "tablet-3", assignments, [{ deviceId: "tablet-3", role: PREBILL, printerId: "p-y" }])?.printerId, "p-y");
});

test("missing assignments (Step 7's 'No printer assigned for …')", () => {
  assert.deepEqual(missingRoles([kitchen, bar, RECEIPT, PREBILL, REPORTS], assignments), [REPORTS]);
  assert.deepEqual(missingRoles([PREBILL], []), [PREBILL]);
  assert.deepEqual(missingRoles([stationRole("new")], assignments), [stationRole("new")]);
});

test("ESC/POS: reset + code page, then commands byte for byte", () => {
  const bytes = [...new EscPos("WPC1252").align("center").bold(true).size(2, 2).line("Hi").cut("PARTIAL").kickDrawer(5).bytes()];
  assert.deepEqual(bytes, [0x1b, 0x40, 0x1b, 0x74, 16, 0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11, 0x48, 0x69, 0x0a, 0x1d, 0x56, 66, 3, 0x1b, 0x70, 1, 25, 250]);
  assert.deepEqual([...new EscPos().cut("FULL").bytes()].slice(-4), [0x1d, 0x56, 65, 3]);
  assert.deepEqual([...new EscPos().cut("NONE").bytes()].slice(-4), [0x0a, 0x0a, 0x0a, 0x0a]);
  assert.deepEqual([...new EscPos().kickDrawer(2).bytes()].slice(-5), [0x1b, 0x70, 0, 25, 250]);
});

test("text in the code page: ₦ as N; é where the page has it", () => {
  assert.deepEqual(encodeText("₦5", "PC437"), [0x4e, 0x35]);
  assert.deepEqual(encodeText("é", "WPC1252"), [0xe9]);
  assert.deepEqual(encodeText("é", "PC437"), [0x82]);
  assert.deepEqual(encodeText("日", "WPC1252"), [0x3f]);
  assert.equal(lineWidth(58), 32);
  assert.equal(lineWidth(80), 48);
  assert.equal(columns("Total", "₦1,200.00", 20), "Total      ₦1,200.00");
  assert.equal(columns("A very long dish name indeed", "₦9", 16).length, 16);
});

test("the test page: the printer's details, its width, its cut", () => {
  const bytes = testPrintBytes({ name: "Kitchen", connection: "NETWORK", address: "192.168.1.60:9100", paperWidth: 58, codePage: "PC437", cut: "FULL" }, "5 Nov 2026, 09:00");
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.includes("TEST PRINT") && text.includes("Kitchen") && text.includes("192.168.1.60:9100"));
  assert.ok(text.includes("01234567890123456789012345678901\n"), "a 32-character ruler on 58 mm");
  assert.ok(text.includes("Naira: N1,500.00"));
  assert.deepEqual([...bytes.slice(-4)], [0x1d, 0x56, 65, 3]);
  assert.ok(!Buffer.from(bytes).includes(Buffer.from([0x1b, 0x70])), "never kicks the drawer");
});

test("printer input: per connection, the address must make sense", () => {
  const base = { name: "Kitchen", connection: "NETWORK", address: "192.168.1.60", paperWidth: 80, codePage: "PC437", cut: "PARTIAL", openDrawer: false };
  assert.ok(printerSchema.safeParse(base).success);
  const issue = (over: object) => printerSchema.safeParse({ ...base, ...over }).error?.issues[0]?.message;
  assert.equal(issue({ address: "not an ip!" }), "Enter an IP address or host name, like 192.168.1.50 or 192.168.1.50:9100.");
  assert.equal(issue({ connection: "SERIAL", address: "LPT1" }), "Enter a serial port, like COM3 or /dev/ttyUSB0.");
  assert.ok(printerSchema.safeParse({ ...base, connection: "SERIAL", address: "COM3", baudRate: 19200 }).success);
  assert.equal(issue({ connection: "SERIAL", address: "COM3", baudRate: 1234 }), "Choose a baud rate.");
  assert.ok(printerSchema.safeParse({ ...base, connection: "OS", address: "EPSON TM-T20II Receipt" }).success);
  assert.equal(issue({ paperWidth: 72 }), "Paper is 58 or 80 mm.");
  assert.equal(issue({ codePage: "UTF8" }), "Choose a code page.");
  assert.equal(issue({ name: " " }), "Give the printer a name.");
  assert.equal(printerSchema.parse(base).drawerPin, 2);
  assert.equal(assignmentsSchema.safeParse({ rows: [{ role: RECEIPT, printerId: "p", fallbackPrinterId: null, copies: 6 }] }).success, false);
  assert.equal(deviceSchema.parse({ id: "d", name: " ", overrides: [] }).name, null);
});

// ---- Step 3: the tickets the queue prints

import { renderKot, renderPrebill, renderReceipt, renderTicket, type KotTicket, type RenderOptions } from "./tickets";
import { SAMPLE_KOT, SAMPLE_PREBILL, SAMPLE_RECEIPT } from "./sampleTickets";

const opts: RenderOptions = { paperWidth: 80, codePage: "PC437", cut: "PARTIAL", reprint: null, reroutedFrom: null };
const kot: KotTicket = {
  ref: "KOT-000123",
  type: "NEW",
  note: null,
  station: "Kitchen",
  table: "T4",
  orderRef: "ORD-0042",
  orderType: "Dine-in",
  area: "Main hall",
  guests: 2,
  waiter: "Ada",
  createdAt: "2026-11-05T12:30:00.000Z",
  lines: [
    { quantity: 2, name: "Jollof Rice & Chicken", modifiers: "Large · Extra plantain", note: "no pepper" },
    { quantity: 1, name: "Suya", modifiers: null, note: null },
  ],
  items: 3,
};
const text = (bytes: Uint8Array) => previewText(previewEscPos(bytes));

test("KOT: station, table, ref, lines with modifiers and notes, items; the cut", () => {
  const t = text(renderKot(kot, opts));
  for (const part of ["KITCHEN", "T4", "KOT-000123", "ORD-0042", "5 Nov 2026 13:30", "Ada", "Dine-in · Main hall · 2 guests", "2x  Jollof Rice & Chicken", "+ Large · Extra plantain", "» no pepper", "1x  Suya", "Items"]) {
    assert.ok(t.includes(part), part);
  }
  assert.ok(!t.includes("VOID") && !t.includes("REPRINT") && !t.includes("REROUTED"));
  assert.deepEqual([...renderKot(kot, opts).slice(-4)], [0x1d, 0x56, 66, 3]);
  const voided = text(renderKot({ ...kot, type: "VOID", note: "VOID: Wrong item" }, opts));
  assert.ok(voided.includes("*** VOID ***") && voided.includes("VOID: Wrong item") && voided.includes("Items voided"));
});

test("marks: REPRINT and REROUTED FROM <printer>, at the top", () => {
  const t = text(renderKot(kot, { ...opts, reprint: "REPRINT #2", reroutedFrom: "Kitchen printer" }));
  assert.ok(t.indexOf("REROUTED FROM KITCHEN PRINTER") < t.indexOf("*** REPRINT #2 ***"));
  assert.ok(t.indexOf("*** REPRINT #2 ***") < t.indexOf("KOT-000123"));
});

test("copies: the whole ticket that many times; widths follow the printer", () => {
  const one = renderTicket("KOT", kot, opts);
  const two = renderTicket("KOT", kot, opts, 2);
  assert.equal(two.length, one.length * 2);
  assert.deepEqual([...two.slice(one.length, one.length + 5)], [...one.slice(0, 5)]);
  assert.ok(text(renderKot(kot, { ...opts, paperWidth: 58 })).split("\n").includes("-".repeat(32)));
  assert.throws(() => renderTicket("NOPE", {}, opts), /Unknown ticket template/);
});

test("pre-bill: NOT A RECEIPT, lines, totals, the split", () => {
  const t = text(
    renderPrebill(
      {
        company: { name: "RingzPOS", address: "Lagos", phone: "0800" },
        table: "T4",
        ref: "ORD-0042",
        orderType: "Dine-in",
        waiter: "Ada",
        guests: 2,
        printedAt: "2026-11-05T12:30:00.000Z",
        lines: [{ quantity: 2, name: "Jollof", amount: "₦36.00", modifiers: [{ name: "Large", price: "+₦2.00" }], note: null }],
        totals: [["Sub total", "₦36.00"], ["Service charge (10%)", "₦3.60"], ["Tax", "₦0.00"]],
        total: "₦39.60",
        split: { title: "Split equally · 2 parts", parts: [{ label: "Guest 1", amount: "₦19.80", items: "" }] },
      },
      opts,
    ),
  );
  for (const part of ["*** NOT A RECEIPT ***", "2x Jollof", "N36.00", "+ Large +N2.00", "Service charge (10%)", "TOTAL", "N39.60", "Split equally · 2 parts", "Guest 1", "This is not a receipt."]) assert.ok(t.includes(part), part);
});

test("receipt: the same rows as the receipt page", () => {
  const t = text(
    renderReceipt(
      {
        title: "RingzPOS",
        place: "Main Office",
        reference: "SL_0042",
        date: "05/11/2026",
        customer: "Walk-in",
        details: [["Order", "ORD-0042"], ["Table", "T4"]],
        items: [{ name: "Jollof", quantity: 2, unitCost: "₦18.00", subtotal: "₦36.00" }],
        totals: [["Order tax (0%)", "₦0.00"], ["Discount", "₦0.00"], ["Service charge", "₦3.60"]],
        grandTotal: "₦39.60",
        payments: [["Paid · Cash", "₦40.00"]],
        due: "₦0.00",
        status: "Paid",
        afterPayments: [["Tip", "₦0.40"]],
        footer: "Thank you for your purchase.",
      },
      { ...opts, reprint: "REPRINT" },
    ),
  );
  for (const part of ["*** REPRINT ***", "Main Office", "SL_0042", "Walk-in", "Table", "2 x N18.00", "Service charge", "Total", "N39.60", "Paid · Cash", "Due", "Status", "Tip", "Thank you"]) assert.ok(t.includes(part), part);
});

import { alertText } from "./alertText";

test("the printer badge's words", () => {
  assert.equal(alertText({ printer: "Kitchen printer", status: "OFFLINE", waiting: 3, failed: 0 }), "Kitchen printer offline (3 waiting)");
  assert.equal(alertText({ printer: "Receipt", status: "PAPER_OUT", waiting: 1, failed: 2 }), "Receipt out of paper (1 waiting) · 2 failed");
  assert.equal(alertText({ printer: "Bar", status: "ONLINE", waiting: 0, failed: 1 }), "Bar: 1 failed");
});

test("code pages: a character the page has prints as itself; the rest as ASCII stand-ins or ?", () => {
  assert.deepEqual(encodeText("a·b — c… “d”", "PC437"), [0x61, 0xfa, 0x62, 0x20, 0x2d, 0x20, 0x63, 0x2e, 0x2e, 0x2e, 0x20, 0x22, 0x64, 0x22]);
  assert.deepEqual(encodeText("·»×—", "WPC1252"), [0xb7, 0xbb, 0xd7, 0x97]);
  assert.deepEqual(encodeText("é€", "PC858"), [0x82, 0xd5]);
  assert.deepEqual(encodeText("€", "PC850"), [0x45, 0x55, 0x52], "no euro on PC850: EUR");
  assert.deepEqual(encodeText("Ж", "PC866"), [0x86]);
  assert.deepEqual(encodeText("Ж", "PC437"), [0x3f]);
  for (const page of ["PC437", "PC850", "PC858", "WPC1252", "PC866"] as const) {
    for (let b = 0x80; b <= 0xff; b++) {
      const ch = decodeByte(b, page);
      if (ch === "?" || ch === "\ufffd") continue;
      assert.equal(encoderFor(page).get(ch) !== undefined, true, `${page} 0x${b.toString(16)}`);
    }
  }
});

// ---- Step 4: images, the preview, the business look

test("the logo: dithered to 1-bit; transparent is white; in bands of 128 rows", () => {
  const rgba = new Uint8Array(16 * 2 * 4);
  for (let x = 0; x < 16; x++) {
    rgba.set([0, 0, 0, 255], x * 4);
    rgba.set([0, 0, 0, 0], (16 + x) * 4);
  }
  const r = toRaster(rgba, 16, 2);
  assert.deepEqual([...r.data], [0xff, 0xff, 0x00, 0x00]);
  assert.equal(blackAt(r, 3, 0), true);
  assert.equal(blackAt(r, 3, 1), false);
  // 50% grey dithers to about half black.
  const grey = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) grey.set([128, 128, 128, 255], i * 4);
  const g = toRaster(grey, 32, 32);
  const black = [...Array(32 * 32)].filter((_, i) => blackAt(g, i % 32, Math.floor(i / 32))).length;
  assert.ok(black > 400 && black < 620, String(black));
  const tall = { width: 8, height: 300, data: new Uint8Array(300) };
  const cmd = rasterCommand(tall);
  assert.equal(cmd.length, 3 * 8 + 300, "3 bands");
});

test("QR codes: a square raster with a quiet zone", () => {
  const qr = qrRaster("https://ringzpos.com/r/SL_0142", 4);
  assert.equal(qr.width, qr.height);
  assert.equal(qr.width % 4, 0);
  assert.equal(blackAt(qr, 0, 0), false, "quiet zone");
  assert.equal(blackAt(qr, 8, 8), true, "the finder pattern's corner");
});

test("the preview reads the bytes back: alignment, size, bold, images joined, cut, drawer", () => {
  const img = { width: 16, height: 130, data: new Uint8Array(2 * 130).fill(0xff) };
  const bytes = new EscPos("PC437").align("center").bold(true).size(2, 2).line("BIG").size(1, 1).bold(false).align("left").line("plain é").raw(rasterCommand(img)).kickDrawer(2).cut("FULL").bytes();
  const blocks = previewEscPos(bytes);
  assert.deepEqual(blocks[0], { kind: "line", align: "center", runs: [{ text: "BIG", bold: true, w: 2, h: 2 }] });
  assert.deepEqual(blocks[1], { kind: "line", align: "left", runs: [{ text: "plain é", bold: false, w: 1, h: 1 }] });
  const image = blocks[2];
  assert.equal(image.kind === "image" ? image.raster.height : 0, 130, "two bands, one image");
  assert.deepEqual(blocks.slice(3), [{ kind: "drawer", pin: 2 }, { kind: "cut", partial: false }]);
});

test("the look: receipt and pre-bill get logo, header, footer, QR; the KOT the name only", () => {
  const look = { header: ["Mama Put Kitchen", "12 Allen Ave, Ikeja"], footer: ["Thank you!", "Open daily 8am"], logo: { width: 16, height: 4, data: new Uint8Array(8).fill(0xff) }, qr: "https://x.test/r/1", kitchenLarge: false, kotPrices: false };
  const receipt = previewEscPos(renderReceipt(SAMPLE_RECEIPT, { ...opts, look }));
  const r = previewText(receipt);
  assert.equal(receipt[0].kind, "image", "the logo first");
  assert.ok(r.indexOf("Mama Put Kitchen") < r.indexOf("12 Allen Ave, Ikeja") && r.indexOf("12 Allen Ave, Ikeja") < r.indexOf("SL_0142"));
  assert.ok(!r.includes("RingzPOS"), "the header replaces the default name");
  assert.ok(r.indexOf("Thank you!") > r.indexOf("Total") && r.includes("Open daily 8am") && !r.includes("Thank you for your purchase."));
  assert.equal(receipt.filter((b) => b.kind === "image").length, 2, "logo and QR");
  const pre = previewText(previewEscPos(renderPrebill(SAMPLE_PREBILL, { ...opts, look })));
  assert.ok(pre.includes("Mama Put Kitchen") && pre.includes("*** NOT A RECEIPT ***") && pre.includes("Thank you!") && pre.includes("[image"));
  const k = previewText(previewEscPos(renderKot(SAMPLE_KOT, { ...opts, look })));
  assert.ok(k.startsWith("Mama Put Kitchen\nKITCHEN"));
  assert.ok(!k.includes("Thank you!") && !k.includes("[image") && !k.includes("12 Allen"), "no logo, footer or QR on the KOT");
  assert.ok(!k.includes("N9,000.00"), "prices off by default");
});

test("KOT: large type halves the characters a line; prices when set", () => {
  const look = { header: [], footer: [], logo: null, qr: null, kitchenLarge: true, kotPrices: true };
  const blocks = previewEscPos(renderKot(SAMPLE_KOT, { ...opts, look }));
  const jollof = blocks.find((b) => b.kind === "line" && b.runs.some((run) => run.text.includes("Jollof")));
  assert.ok(jollof && jollof.kind === "line" && jollof.runs[0].w === 2 && jollof.runs[0].h === 2);
  const t = previewText(blocks);
  assert.ok(t.includes("N9,000.00") && t.includes("N4,500.00"));
  const normal = previewEscPos(renderKot(SAMPLE_KOT, { ...opts, look: { ...look, kitchenLarge: false } }));
  const line = normal.find((b) => b.kind === "line" && b.runs.some((run) => run.text.includes("Jollof")));
  assert.ok(line && line.kind === "line" && line.runs[0].w === 1);
});

// ---- Step 5: the cash drawer

test("the drawer kick: reset, then ESC p on the pin — nothing printed, no paper moved", () => {
  assert.deepEqual([...drawerBytes(2)].slice(-5), [0x1b, 0x70, 0, 25, 250]);
  assert.deepEqual([...drawerBytes(5)].slice(-5), [0x1b, 0x70, 1, 25, 250]);
  assert.deepEqual([...drawerBytes(7)].slice(-5), [0x1b, 0x70, 0, 25, 250], "anything else: pin 2");
  assert.deepEqual([...drawerBytes(5)].slice(0, 2), [0x1b, 0x40]);
  assert.deepEqual(previewEscPos(drawerBytes(5)), [{ kind: "drawer", pin: 5 }]);
  assert.equal(DRAWER_TTL_MS, 30_000);
});

test("cash taken: some cash above zero — card, transfer or a zero cash line don't open it", () => {
  assert.equal(tookCash([{ paymentType: "CASH", amount: "1500.00" }]), true);
  assert.equal(tookCash([{ paymentType: "CARD", amount: "1000" }, { paymentType: "CASH", amount: "500" }]), true, "split: the cash part");
  assert.equal(tookCash([{ paymentType: "CARD", amount: "1000" }]), false);
  assert.equal(tookCash([{ paymentType: "BANK_TRANSFER", amount: "20" }, { paymentType: "CASH", amount: "0.00" }]), false);
  assert.equal(tookCash([]), false);
});

test("the drawer log's result, from the kick's job", () => {
  assert.deepEqual(drawerOutcome("DONE"), { label: "Opened", tone: "ok" });
  assert.equal(drawerOutcome("QUEUED").tone, "wait");
  assert.equal(drawerOutcome("PRINTING").tone, "wait");
  assert.deepEqual(drawerOutcome("CANCELLED"), { label: "Not opened", tone: "bad" });
  assert.deepEqual(drawerOutcome("FAILED"), { label: "Failed", tone: "bad" });
});

test("Open drawer by hand needs a reason (trimmed, at most 140)", () => {
  assert.deepEqual(drawerOpenSchema.parse({ reason: "  Give change " }), { reason: "Give change" });
  assert.equal(drawerOpenSchema.safeParse({ reason: "   " }).success, false);
  assert.equal(drawerOpenSchema.safeParse({}).success, false);
  assert.equal(drawerOpenSchema.safeParse({ reason: "x".repeat(141) }).success, false);
  assert.equal(drawerOpenSchema.safeParse({ reason: "x".repeat(140) }).success, true);
});
