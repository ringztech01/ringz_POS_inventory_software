// Run with: npx tsx --test modules/restaurant/__tests__/menuAddressCheck.test.ts
// 6g follow-up 5: the QR codes' address — ringzpos.local first while the app
// answers for it, the warning when the saved address isn't this PC's any
// more, the IP printed under a .local code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addressChoices, checkMenuAddress, ipFallback } from "../lib/menuAddress";
import { menuCardSvg } from "../lib/menuCard";

const cards = { "Wi-Fi": [{ address: "192.168.100.148", family: "IPv4", internal: false }] };
const choices = addressChoices(cards, "DESKTOP-5H82Q3A", 3000, "ringzpos.local");

test("ringzpos.local first while it's answering, then the IP, then the PC's own name", () => {
  assert.deepEqual(choices.map((c) => [c.url, c.kind]), [
    ["http://ringzpos.local:3000", "app"],
    ["http://192.168.100.148:3000", "ip"],
    ["http://desktop-5h82q3a.local:3000", "name"],
  ]);
  assert.ok(choices[0].label.includes("recommended"));
  assert.equal(addressChoices(cards, "DESKTOP-5H82Q3A", 3000).some((c) => c.kind === "app"), false, "not answering: not offered");
});

test("the saved address against this PC: ok, moved (with what to save instead), other, none", () => {
  assert.deepEqual(checkMenuAddress("http://192.168.100.148:3000", choices), { state: "ok", suggested: "http://ringzpos.local:3000" });
  assert.equal(checkMenuAddress("http://ringzpos.local:3000", choices).state, "ok");
  assert.equal(checkMenuAddress("http://desktop-5h82q3a.local:3000", choices).state, "ok");
  assert.deepEqual(checkMenuAddress("http://192.168.0.3:3000", choices), { state: "moved", suggested: "http://ringzpos.local:3000" }, "the IP it had this morning");
  assert.equal(checkMenuAddress("http://192.168.100.148:4000", choices).state, "moved", "another port");
  assert.equal(checkMenuAddress("http://old-pc.local:3000", choices).state, "moved", "another PC's name");
  assert.equal(checkMenuAddress("https://menu.example.com", choices).state, "other", "a domain: can't tell");
  assert.deepEqual(checkMenuAddress(null, choices), { state: "none", suggested: "http://ringzpos.local:3000" });
  // ringzpos.local saved but the app isn't answering for it: moved, the IP instead.
  const quiet = addressChoices(cards, "DESKTOP-5H82Q3A", 3000);
  assert.deepEqual(checkMenuAddress("http://ringzpos.local:3000", quiet), { state: "moved", suggested: "http://192.168.100.148:3000" });
});

test("the IP printed under a .local code: same port; none for an IP address", () => {
  assert.equal(ipFallback("http://ringzpos.local:3000", "192.168.100.148"), "http://192.168.100.148:3000");
  assert.equal(ipFallback("http://ringzpos.local", "10.0.0.7"), "http://10.0.0.7");
  assert.equal(ipFallback("http://192.168.100.148:3000", "192.168.100.148"), null);
  assert.equal(ipFallback("http://ringzpos.local:3000", null), null);
});

test("the printed card: the .local link, and the IP under it", () => {
  const qr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;
  const base = { business: "Ringz", title: "Table 5", subtitle: "Main Hall", qrSvg: qr, link: "http://ringzpos.local:3000/menu/abc", accent: "#0f7d6a" };
  const withIp = menuCardSvg({ ...base, fallback: "http://192.168.100.148:3000/menu/abc" });
  assert.ok(withIp.includes(">http://ringzpos.local:3000/menu/abc<") && withIp.includes(">or http://192.168.100.148:3000/menu/abc<"));
  const plain = menuCardSvg(base);
  assert.ok(!plain.includes(">or "), "no fallback: one line, as before");
});
