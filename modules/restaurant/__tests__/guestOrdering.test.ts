// Run with: npx tsx --test modules/restaurant/__tests__/guestOrdering.test.ts
// Part 8 Step 7: guest ordering's rules (lib/guestOrdering.ts) — the mode,
// the per-code send limits, the caps, the restaurant-network check, what a
// guest's line shows, and the basket kept on the phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addToBasket,
  basketKey,
  capProblem,
  cleanGuestName,
  GUEST_NAME_MAX,
  GUEST_POINT_SENDS_PER_WINDOW,
  POINT_NOTE,
  GUEST_LINE_QTY_MAX,
  GUEST_SEND_GAP_MS,
  GUEST_SENDS_PER_WINDOW,
  GUEST_SEND_WINDOW_MS,
  guestMode,
  guestOrderAnnouncement,
  guestStage,
  isLanRequest,
  isPrivateAddress,
  isUnderway,
  readBasket,
  refuseSend,
} from "../lib/guestOrdering";
import { noTableLabel } from "../lib/orderLines";

const now = new Date("2026-11-17T19:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

test("the mode: a waiter confirms by default; auto-send wins; neither puts lines straight on", () => {
  assert.equal(guestMode({ autoSendGuestOrders: false, requireWaiterConfirm: true }), "confirm");
  assert.equal(guestMode({ autoSendGuestOrders: false, requireWaiterConfirm: false }), "direct");
  assert.equal(guestMode({ autoSendGuestOrders: true, requireWaiterConfirm: true }), "auto");
  assert.equal(guestMode({ autoSendGuestOrders: true, requireWaiterConfirm: false }), "auto");
});

test("per code: one send every 30 s, at most 6 in 15 minutes", () => {
  assert.equal(refuseSend([], now), null);
  assert.equal(refuseSend([ago(GUEST_SEND_GAP_MS - 1)], now), "too_soon");
  assert.equal(refuseSend([ago(GUEST_SEND_GAP_MS)], now), null);
  const five = Array.from({ length: GUEST_SENDS_PER_WINDOW - 1 }, (_, i) => ago(60_000 * (i + 1)));
  assert.equal(refuseSend(five, now), null);
  assert.equal(refuseSend([...five, ago(10 * 60_000)], now), "too_many");
  assert.equal(refuseSend([...five, ago(GUEST_SEND_WINDOW_MS + 1)], now), null, "an old send no longer counts");
});

test("the caps: lines, then value (in kobo); no value cap when none is set", () => {
  assert.deepEqual(capProblem({ lines: 0, value: "0", maxLines: 20, maxValue: null }), { kind: "empty" });
  assert.deepEqual(capProblem({ lines: 21, value: "100", maxLines: 20, maxValue: null }), { kind: "lines", max: 20 });
  assert.equal(capProblem({ lines: 20, value: "999999999.99", maxLines: 20, maxValue: null }), null);
  assert.equal(capProblem({ lines: 3, value: "100000.00", maxLines: 20, maxValue: "100000.00" }), null, "exactly the cap is fine");
  assert.deepEqual(capProblem({ lines: 3, value: "100000.01", maxLines: 20, maxValue: "100000.00" }), { kind: "value" });
  assert.deepEqual(capProblem({ lines: 3, value: "100000.1", maxLines: 20, maxValue: "100000" }), { kind: "value" });
});

test("private addresses: IPv4 ranges, IPv6 local, IPv4-mapped", () => {
  for (const ip of ["10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.20", "127.0.0.1", "169.254.3.4", "::1", "fe80::1", "fd12:3456::1", "::ffff:192.168.1.5"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "100.64.0.1", "2001:db8::1", "::ffff:8.8.8.8", "999.1.1.1", "example.com", ""]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("only from the restaurant's network: the host the phone used and every forwarded address", () => {
  assert.equal(isLanRequest("192.168.1.20:3000", "192.168.1.57"), true);
  assert.equal(isLanRequest("localhost:3000", "::1"), true);
  assert.equal(isLanRequest("ringz-pc.local:3000", "::ffff:10.0.0.9"), true);
  assert.equal(isLanRequest("192.168.1.20:3000", null), true, "no forwarded address recorded");
  assert.equal(isLanRequest("[fe80::1]:3000", "fe80::22"), true);
  assert.equal(isLanRequest("41.58.10.2:3000", "41.190.3.3"), false, "a public address");
  assert.equal(isLanRequest("menu.example.com", "192.168.1.57"), false, "a public name");
  assert.equal(isLanRequest("192.168.1.20:3000", "192.168.1.57, 41.190.3.3"), false, "a public hop in the chain");
  assert.equal(isLanRequest("pos.lan:3000", "192.168.1.57", "pos.lan:3000"), true, "the menu's saved address");
  assert.equal(isLanRequest(null, "192.168.1.57"), false);
});

test("a guest's line: waiting, then the kitchen's stages; rejected; a pending line on a closed order wasn't taken", () => {
  const line = (status: "PENDING" | "CONFIRMED" | "REJECTED", item: Parameters<typeof guestStage>[0]["item"], orderOpen = true) => guestStage({ status, orderOpen, item });
  assert.equal(line("PENDING", null), "waiting");
  assert.equal(line("PENDING", null, false), "rejected");
  assert.equal(line("REJECTED", null), "rejected");
  assert.equal(line("CONFIRMED", { kitchenStatus: "NEW", cancelled: false }), "waiting", "confirmed, not sent yet");
  assert.equal(line("CONFIRMED", { kitchenStatus: "PENDING", cancelled: false }), "sent");
  assert.equal(line("CONFIRMED", { kitchenStatus: "PREPARING", cancelled: false }), "preparing");
  assert.equal(line("CONFIRMED", { kitchenStatus: "READY", cancelled: false }), "ready");
  assert.equal(line("CONFIRMED", { kitchenStatus: "SERVED", cancelled: false }), "served");
  assert.equal(line("CONFIRMED", { kitchenStatus: "PENDING", cancelled: true }), "cancelled");
  assert.equal(line("CONFIRMED", null), "cancelled", "its order line was removed");
  assert.equal(line("CONFIRMED", { kitchenStatus: "NEW", cancelled: false }, false), "cancelled", "never sent before the order closed");
  assert.deepEqual((["waiting", "sent", "preparing", "ready", "served", "rejected", "cancelled"] as const).map(isUnderway), [true, true, true, true, false, false, false]);
});

test("the basket: the same dish, options and note add up; a different note is its own line; capped", () => {
  let basket = addToBasket([], { productId: "p1", modifierIds: ["b", "a"], note: " no pepper ", quantity: 2 });
  basket = addToBasket(basket, { productId: "p1", modifierIds: ["a", "b"], note: "no pepper", quantity: 1 });
  assert.equal(basket.length, 1);
  assert.equal(basket[0].quantity, 3);
  assert.equal(basket[0].note, "no pepper");
  basket = addToBasket(basket, { productId: "p1", modifierIds: ["a", "b"], note: "", quantity: 1 });
  assert.equal(basket.length, 2);
  basket = addToBasket(basket, { productId: "p1", modifierIds: ["a", "b"], note: "", quantity: 50 });
  assert.equal(basket[1].quantity, GUEST_LINE_QTY_MAX);
  assert.equal(basketKey("p1", ["b", "a"], "x "), basketKey("p1", ["a", "b"], "x"));
});

test("a stored basket is read safely: junk dropped, quantities and notes kept in bounds", () => {
  assert.deepEqual(readBasket("nope"), []);
  const read = readBasket([{ productId: "p1", modifierIds: ["m"], note: "x".repeat(500), quantity: 999 }, { productId: 5 }, null, { productId: "p2", modifierIds: [3] }, { productId: "p3", modifierIds: [], quantity: 0 }]);
  assert.equal(read.length, 2);
  assert.equal(read[0].quantity, GUEST_LINE_QTY_MAX);
  assert.ok(read[0].note.length <= 140);
  assert.equal(read[1].quantity, 1);
});

test("the toast names the table, its area when elsewhere, and how many lines", () => {
  const order = { orderId: "o", tableId: "t", tableName: "5", areaId: "a1", areaName: "Terrace", label: null, lines: 3, sendId: "s", minutes: 0, waiterIds: [] };
  assert.equal(guestOrderAnnouncement(order, "a1"), "Table 5 · Guest order (3 lines)");
  assert.equal(guestOrderAnnouncement({ ...order, lines: 1 }, "a2"), "Table 5 (Terrace) · Guest order (1 line)");
  assert.equal(guestOrderAnnouncement({ ...order, tableId: null, areaId: null, label: "Takeaway · Ada" }, "a1"), "Takeaway · Ada · Guest order (3 lines)", "a QR point's (Step 8)");
});

test("Step 8: a guest's name for a QR point's order, cleaned and capped", () => {
  assert.equal(cleanGuestName("  Ada   Obi "), "Ada Obi");
  assert.equal(cleanGuestName("A" + String.fromCharCode(0) + "da" + String.fromCharCode(27)), "Ada");
  assert.equal(cleanGuestName("x".repeat(60))?.length, GUEST_NAME_MAX);
  for (const empty of ["", "   ", String.fromCharCode(10, 9), null, undefined, 42]) assert.equal(cleanGuestName(empty), null);
});

test("Step 8: at a QR point the per-code limit is looser and has no gap", () => {
  const many = Array.from({ length: GUEST_POINT_SENDS_PER_WINDOW - 1 }, (_, i) => ago(1000 * (i + 1)));
  assert.equal(refuseSend(many, now, GUEST_POINT_SENDS_PER_WINDOW, 0), null, "phones one after another at the counter");
  assert.equal(refuseSend([...many, ago(500)], now, GUEST_POINT_SENDS_PER_WINDOW, 0), "too_many");
  assert.equal(refuseSend([ago(1000)], now), "too_soon", "one phone: still 30 s apart");
});

test("Step 8: a takeaway shows the guest's name like a tab does; notes for the POS", () => {
  assert.equal(noTableLabel("TAKEAWAY", "Ada"), "Takeaway · Ada");
  assert.equal(noTableLabel("TAKEAWAY", null), "Takeaway");
  assert.equal(noTableLabel("BAR_TAB", "Ada"), "Tab · Ada");
  assert.deepEqual(POINT_NOTE, { takeaway: "Pay at counter", bar: "Pay at the bar" });
});
