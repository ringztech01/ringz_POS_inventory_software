// Run with: npx tsx --test lib/hardware/mdns.test.ts
// 6g follow-up 5: the app's name on the Wi-Fi — reading a phone's question,
// writing the answer (RFC 6762), and which of this PC's addresses to give.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addressFor, answerA, APP_MDNS_NAME, asksFor, parseQuery } from "./mdns";
import { lanAddresses } from "../lanAddresses";

// A question as a phone sends it: id, flags 0, one question, name, type, class.
function question(name: string, type = 1, klass = 1, id = 0): Buffer {
  const labels = name.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, "latin1")]));
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(klass, 2);
  return Buffer.concat([header, ...labels, Buffer.from([0]), tail]);
}

test("reads a phone's question for ringzpos.local (A, any case; QU bit)", () => {
  const q = parseQuery(question("RingzPOS.local"));
  assert.deepEqual(q, { id: 0, questions: [{ name: "ringzpos.local", type: 1, unicast: false }] });
  assert.equal(asksFor(q!.questions[0], APP_MDNS_NAME), true);
  assert.equal(parseQuery(question(APP_MDNS_NAME, 1, 0x8001))?.questions[0].unicast, true, "the 'reply to me' bit");
  assert.equal(asksFor(parseQuery(question(APP_MDNS_NAME, 28))!.questions[0], APP_MDNS_NAME), false, "AAAA: not answered (no IPv6 here)");
  assert.equal(asksFor(parseQuery(question(APP_MDNS_NAME, 255))!.questions[0], APP_MDNS_NAME), true, "ANY");
  assert.equal(asksFor(parseQuery(question("other.local"))!.questions[0], APP_MDNS_NAME), false);
});

test("ignores answers and anything malformed; follows name pointers safely", () => {
  const answer = answerA(APP_MDNS_NAME, "192.168.1.20");
  assert.equal(parseQuery(answer), null, "an answer isn't a question");
  assert.equal(parseQuery(Buffer.from([1, 2, 3])), null);
  const cut = question(APP_MDNS_NAME).subarray(0, 20);
  assert.equal(parseQuery(cut), null, "cut short");
  // A pointer to itself: no endless loop.
  const loop = Buffer.concat([question("a.local").subarray(0, 12), Buffer.from([0xc0, 12, 0, 1, 0, 1])]);
  assert.equal(parseQuery(loop), null);
});

test("the answer: ringzpos.local is at the IP, cache-flush, two minutes; a plain DNS client gets its id and question back", () => {
  const a = answerA(APP_MDNS_NAME, "192.168.100.148");
  assert.equal(a.readUInt16BE(0), 0, "id 0");
  assert.equal(a.readUInt16BE(2), 0x8400, "a response, authoritative");
  assert.deepEqual([a.readUInt16BE(4), a.readUInt16BE(6)], [0, 1], "no question, one answer");
  const tail = a.subarray(a.length - 14);
  assert.deepEqual([tail.readUInt16BE(0), tail.readUInt16BE(2), tail.readUInt32BE(4), tail.readUInt16BE(8)], [1, 0x8001, 120, 4]);
  assert.deepEqual([...a.subarray(a.length - 4)], [192, 168, 100, 148]);
  assert.ok(a.includes(Buffer.from("\x08ringzpos\x05local\x00", "latin1")));
  const legacy = answerA(APP_MDNS_NAME, "10.0.0.7", { legacy: { id: 0x1234 } });
  assert.deepEqual([legacy.readUInt16BE(0), legacy.readUInt16BE(4), legacy.readUInt16BE(6)], [0x1234, 1, 1]);
  const lt = legacy.subarray(legacy.length - 14);
  assert.deepEqual([lt.readUInt16BE(2), lt.readUInt32BE(4)], [1, 10], "no cache-flush, ten seconds");
  assert.throws(() => answerA(APP_MDNS_NAME, "999.1.1.1"));
});

test("which address to give: the one on the asker's network, else the first", () => {
  const mine = [
    { address: "192.168.100.148", netmask: "255.255.255.0" },
    { address: "10.0.5.2", netmask: "255.255.0.0" },
  ];
  assert.equal(addressFor("192.168.100.37", mine), "192.168.100.148");
  assert.equal(addressFor("10.0.9.9", mine), "10.0.5.2");
  assert.equal(addressFor("172.16.0.4", mine), "192.168.100.148");
  assert.equal(addressFor("1.2.3.4", []), null);
});

test("this PC's LAN addresses: real cards only, private ranges first", () => {
  const cards = {
    "Wi-Fi": [{ address: "192.168.100.148", family: "IPv4", internal: false, netmask: "255.255.255.0" }, { address: "fe80::1", family: "IPv6", internal: false }],
    "vEthernet (WSL (Hyper-V firewall))": [{ address: "172.26.16.1", family: "IPv4", internal: false }],
    Ethernet: [{ address: "169.254.219.172", family: "IPv4", internal: false }],
    "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  };
  assert.deepEqual(lanAddresses(cards), [{ address: "192.168.100.148", netmask: "255.255.255.0", card: "Wi-Fi" }]);
});
