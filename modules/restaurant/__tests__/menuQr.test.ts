// Run with: npx tsx --test modules/restaurant/__tests__/menuQr.test.ts
// Part 8 Step 2: the address the menu's QR codes open, and the printed card.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import { addressChoices, isPrivateIpv4, menuLink, parseMenuAddress } from "../lib/menuAddress";
import { escapeXml, fitSize, menuCardSvg, type MenuCard } from "../lib/menuCard";
import { newQrPointSchema, renameQrPointSchema, menuWifiSchema } from "../schemas/menuQr";

describe("the menu's address", () => {
  // This PC's cards on 15 Nov 2026: a cable with no network (169.254), a
  // phone's hotspot, WSL's virtual switch, and the loopback.
  const cards = {
    "ICCO-Mikrotik": [{ address: "169.254.219.172", family: "IPv4", internal: false }],
    "Ethernet 3": [
      { address: "172.20.10.4", family: "IPv4", internal: false },
      { address: "fe80::1", family: "IPv6", internal: false },
    ],
    "vEthernet (WSL (Hyper-V firewall))": [{ address: "172.26.16.1", family: "IPv4", internal: false }],
    "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    "Wi-Fi": [{ address: "192.168.1.20", family: 4, internal: false }],
  };

  test("the choices: real cards' IPv4 (private first), then the PC's name — never link-local, virtual or loopback", () => {
    assert.deepEqual(
      addressChoices(cards, "DESKTOP-5H82Q3A", 3000).map((c) => [c.url, c.kind]),
      [
        ["http://172.20.10.4:3000", "ip"],
        ["http://192.168.1.20:3000", "ip"],
        ["http://desktop-5h82q3a.local:3000", "name"],
      ],
    );
    assert.equal(addressChoices(cards, "pos", 80)[0].url, "http://172.20.10.4", "port 80 isn't written");
    assert.equal(addressChoices({ "Wi-Fi": [{ address: "203.0.113.5", family: "IPv4", internal: false }, { address: "10.0.0.9", family: "IPv4", internal: false }] }, "", 3000)[0].url, "http://10.0.0.9:3000", "a private address before a public one");
    assert.deepEqual(addressChoices({}, "bad name!", 3000), [], "a name that isn't a host name isn't offered");
  });

  test("private ranges", () => {
    assert.deepEqual(["10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.0.5", "172.32.0.1", "8.8.8.8"].map(isPrivateIpv4), [true, true, true, true, false, false]);
  });

  test("what an admin types: kept as http(s)://host[:port]", () => {
    assert.deepEqual(parseMenuAddress("192.168.1.20:3000"), { ok: true, url: "http://192.168.1.20:3000" });
    assert.deepEqual(parseMenuAddress(" http://pos.local:3000/ "), { ok: true, url: "http://pos.local:3000" });
    assert.deepEqual(parseMenuAddress("HTTPS://Menu.Example.lan"), { ok: true, url: "https://menu.example.lan" });
    assert.deepEqual(parseMenuAddress("http://192.168.1.20:80"), { ok: true, url: "http://192.168.1.20" });
  });

  test("refused: empty, not http(s), a path or query, this machine only, link-local", () => {
    const refused = (text: string) => {
      const r = parseMenuAddress(text);
      return r.ok ? "accepted" : r.error;
    };
    assert.match(refused(""), /Enter the server's address/);
    assert.match(refused("ftp://192.168.1.20"), /http:\/\/ or https:\/\//);
    assert.match(refused("http://192.168.1.20:3000/menu"), /nothing after it/);
    assert.match(refused("http://192.168.1.20:3000?x=1"), /nothing after it/);
    assert.match(refused("http://user:pw@192.168.1.20"), /nothing after it/);
    for (const local of ["localhost:3000", "http://127.0.0.1:3000", "http://0.0.0.0:3000", "http://[::1]:3000"]) assert.match(refused(local), /only works on this computer/, local);
    assert.match(refused("http://169.254.219.172:3000"), /isn't on a network/);
    assert.match(refused("http://exa mple"), /isn't an address/);
  });

  test("a code's link: the address, /menu/, the token — nothing about the table", () => {
    assert.equal(menuLink("http://192.168.1.20:3000", "AbC_-123"), "http://192.168.1.20:3000/menu/AbC_-123");
  });
});

describe("the card", () => {
  const base = async (over: Partial<MenuCard> = {}): Promise<MenuCard> => ({
    business: "Ringz Kitchen",
    title: "Table T4",
    subtitle: "Main Hall",
    qrSvg: await QRCode.toString("http://192.168.1.20:3000/menu/tok", { type: "svg" }),
    link: "http://192.168.1.20:3000/menu/tok",
    wifi: null,
    accent: "#0f7d6a",
    ...over,
  });

  test("A6: the business, Scan for menu, the table, its area, the code and the link", async () => {
    const svg = menuCardSvg(await base());
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="105mm" height="148mm" viewBox="0 0 1050 1480">/);
    for (const text of ["Ringz Kitchen", "Scan for menu", "Table T4", "Main Hall", "http://192.168.1.20:3000/menu/tok"]) assert.ok(svg.includes(`>${text}</text>`), text);
    assert.match(svg, /<svg x="245" y="570" width="560" height="560"/, "the code, placed");
    assert.ok(!svg.includes("<?xml"), "one document");
    assert.doesNotMatch(svg, /Wi-Fi/, "no Wi-Fi when none is set");
  });

  test("the Wi-Fi when set (the password only if there is one); a logo instead of the name", async () => {
    const withPassword = menuCardSvg(await base({ wifi: { name: "Ringz Guest", password: "jollof2026" } }));
    assert.ok(withPassword.includes(">Wi-Fi: Ringz Guest</text>") && withPassword.includes(">Password: jollof2026</text>"));
    const open = menuCardSvg(await base({ wifi: { name: "Ringz Guest", password: null } }));
    assert.ok(open.includes(">Wi-Fi: Ringz Guest</text>") && !open.includes("Password"));
    const logo = menuCardSvg(await base({ logo: "data:image/png;base64,AAAA" }));
    assert.ok(logo.includes('<image href="data:image/png;base64,AAAA"') && !logo.includes(">Ringz Kitchen</text>"));
  });

  test("as an image: pixels; text is escaped; a bad accent colour falls back", async () => {
    const svg = menuCardSvg(await base({ title: 'Table <4> & "Co"', accent: "red;}" }), "image");
    assert.match(svg, /width="1050" height="1480"/);
    assert.ok(svg.includes(">Table &lt;4&gt; &amp; &quot;Co&quot;</text>"));
    assert.ok(svg.includes('fill="#0f7d6a"'));
    assert.equal(escapeXml("a\u0001b'"), "ab&apos;");
  });

  test("long text gets smaller, not wider", () => {
    assert.equal(fitSize("T4", 100, 14), 100);
    assert.ok(fitSize("Rooftop terrace table 12", 100, 14) < 100);
    assert.ok(fitSize("x".repeat(200), 100, 14) >= 45, "never unreadably small");
  });

  test("the code holds the link (a phone opens exactly this)", async () => {
    // qrcode's own segments for the link (bytes and alphanumerics), joined
    // back: the code is made from it, nothing added.
    const made = QRCode.create("http://192.168.1.20:3000/menu/tok", { errorCorrectionLevel: "M" });
    const data: unknown[] = made.segments.map((s) => s.data);
    assert.equal(data.map((d) => (d instanceof Uint8Array ? Buffer.from(d).toString("latin1") : String(d))).join(""), "http://192.168.1.20:3000/menu/tok");
  });

  test("the tokens differ, so the cards' codes do", async () => {
    const a = await QRCode.toString("http://192.168.1.20:3000/menu/AAAA", { type: "svg" });
    const b = await QRCode.toString("http://192.168.1.20:3000/menu/BBBB", { type: "svg" });
    assert.notEqual(menuCardSvg(await base({ qrSvg: a })), menuCardSvg(await base({ qrSvg: b })));
  });
});

describe("QR points and Wi-Fi: what the actions accept", () => {
  test("a point: a name (1–40) and Takeaway or Bar", () => {
    assert.equal(newQrPointSchema.safeParse({ name: "Takeaway counter", orderType: "TAKEAWAY" }).success, true);
    assert.equal(newQrPointSchema.safeParse({ name: "Bar", orderType: "BAR_TAB" }).success, true);
    assert.equal(newQrPointSchema.safeParse({ name: "  ", orderType: "TAKEAWAY" }).success, false);
    assert.equal(newQrPointSchema.safeParse({ name: "x".repeat(41), orderType: "TAKEAWAY" }).success, false);
    assert.equal(newQrPointSchema.safeParse({ name: "Patio", orderType: "DINE_IN" }).success, false, "a point isn't a table");
    assert.equal(renameQrPointSchema.safeParse({ id: "p1", name: "Front bar" }).success, true);
  });

  test("Wi-Fi: up to 64 characters each", () => {
    assert.equal(menuWifiSchema.safeParse({ name: "Ringz Guest", password: "" }).success, true);
    assert.equal(menuWifiSchema.safeParse({ name: "x".repeat(65), password: "" }).success, false);
  });
});
