// Run with: npx tsx --test modules/restaurant/__tests__/tabletDevice.test.ts
// Part 6g Step 1: which devices get the tablet screens (lib/tabletDevice.ts)
// and where each service screen is on a tablet and on a desktop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectedKind, deviceKind, isSwitchablePath, isTabletBrowser, isTabletPublicPath, screenRedirect, TABLET_AUTO_READY } from "../lib/tabletDevice";
import { routesFor } from "../lib/serviceRoutes";

const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_MODE = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const KINDLE = "Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 (KHTML, like Gecko) Silk/120.4.1 like Chrome/120.0.6099.230 Safari/537.36";

test("a tablet's browser: Android without Mobile, an iPad, an iPad's Safari in desktop mode (touch), a Kindle", () => {
  assert.equal(isTabletBrowser(ANDROID_TABLET), true);
  assert.equal(isTabletBrowser(IPAD), true);
  assert.equal(isTabletBrowser(IPAD_DESKTOP_MODE, true), true);
  assert.equal(isTabletBrowser(KINDLE), true);
});

test("not a tablet: a phone, a PC (touch screen or not), a Mac, nothing known", () => {
  assert.equal(isTabletBrowser(ANDROID_PHONE), false);
  assert.equal(isTabletBrowser(WINDOWS), false);
  assert.equal(isTabletBrowser(WINDOWS, true), false, "a touch-screen PC is still a desktop");
  assert.equal(isTabletBrowser(IPAD_DESKTOP_MODE, false), false, "a Mac");
  assert.equal(isTabletBrowser(null), false);
  assert.equal(isTabletBrowser(""), false);
});

test("the Screen setting: Tablet and Desktop win; Auto goes by the browser once it's switched on", () => {
  assert.equal(deviceKind("TABLET", WINDOWS), "TABLET");
  assert.equal(deviceKind("DESKTOP", ANDROID_TABLET), "DESKTOP");
  assert.equal(deviceKind("AUTO", ANDROID_TABLET, false, true), "TABLET");
  assert.equal(deviceKind("AUTO", WINDOWS, false, true), "DESKTOP");
  assert.equal(deviceKind(null, IPAD, false, true), "TABLET", "a browser that isn't a known device yet");
  assert.equal(deviceKind("AUTO", ANDROID_TABLET, false, false), "DESKTOP", "Auto off: today's screens");
  assert.equal(TABLET_AUTO_READY, true, "Auto is on (Step 7)");
  assert.equal(deviceKind("AUTO", ANDROID_TABLET), "TABLET", "on Auto, an Android tablet gets the tablet screens");
  assert.equal(deviceKind("AUTO", WINDOWS), "DESKTOP", "on Auto, a desktop keeps the POS screens");
  assert.equal(deviceKind("AUTO", "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"), "DESKTOP", "a phone isn't a tablet");
  assert.equal(detectedKind(ANDROID_TABLET), "TABLET", "what Settings › Devices shows for Auto");
  assert.equal(detectedKind(WINDOWS), "DESKTOP");
});

test("the tablet's routes: Tables and an order on /t/…; a Classic device keeps Classic", () => {
  const tablet = routesFor("SERVICE", { tablet: true });
  assert.equal(tablet.tables(), "/t/tables");
  assert.equal(tablet.tables({ areaId: "a1", focus: "bar" }), "/t/tables?area=a1&focus=bar", "a Bartender: the bar first");
  assert.equal(tablet.tables({ focus: "pay" }), "/t/tables");
  assert.equal(tablet.order("o 1"), "/t/order/o%201");
  assert.equal(tablet.order("o1", { pay: true }), "/t/order/o1?pay=1");
  assert.equal(tablet.pos, "/t/tables");
  assert.equal(routesFor("CLASSIC", { tablet: true }).tables(), "/restaurant/floor");
  assert.equal(routesFor("SERVICE").tables(), "/pos/floor");
});

const q = (s = "") => new URLSearchParams(s);
const service = routesFor("SERVICE");
const classic = routesFor("CLASSIC");

test("on a tablet: the desktop service screens go to their tablet ones", () => {
  assert.equal(screenRedirect("/pos/floor", q("area=a1&from=o9"), true, service), "/t/tables?area=a1");
  assert.equal(screenRedirect("/pos", q("order=o1"), true, service), "/t/order/o1");
  assert.equal(screenRedirect("/pos", q("order=o1&pay=1"), true, service), "/t/order/o1?pay=1");
  assert.equal(screenRedirect("/pos", q(), true, service), "/t/tables");
  assert.equal(screenRedirect("/restaurant/floor", q("area=a2"), true, service), "/t/tables?area=a2");
  assert.equal(screenRedirect("/restaurant/orders/o2", q(), true, service), "/t/order/o2");
  assert.equal(screenRedirect("/restaurant/orders", q(), true, service), "/t/tables");
  assert.equal(screenRedirect("/t", q(), true, service), "/t/tables");
  for (const path of ["/t/tables", "/t/login", "/t/order/o1", "/t/order/new"]) assert.equal(screenRedirect(path, q(), true, service), null, path);
});

test("on a desktop: the tablet screens go to the desktop ones (its Service or Classic view)", () => {
  assert.equal(screenRedirect("/t/tables", q("area=a1"), false, service), "/pos/floor?area=a1");
  assert.equal(screenRedirect("/t/order/o1", q(), false, service), "/pos?order=o1");
  assert.equal(screenRedirect("/t/order/o1", q("pay=1"), false, service), "/pos?order=o1&pay=1");
  assert.equal(screenRedirect("/t/order/new", q("type=TAKEAWAY"), false, service), "/pos/floor");
  assert.equal(screenRedirect("/t/login", q(), false, service), "/");
  assert.equal(screenRedirect("/t/tables", q(), false, classic), "/restaurant/floor");
  assert.equal(screenRedirect("/t/order/o1", q(), false, classic), "/restaurant/orders/o1");
  for (const path of ["/pos", "/pos/floor", "/restaurant/floor", "/restaurant/orders/o1"]) assert.equal(screenRedirect(path, q(), false, service), null, path);
});

test("what never moves: the receipt, the cash-up, what prints, the back office; the app's own files are public", () => {
  for (const path of ["/pos/receipt/r1", "/pos/cash-up", "/restaurant/bill/o1", "/restaurant/kot/k1", "/restaurant/kitchen", "/restaurant/tables", "/dashboard", "/t/manifest.webmanifest", "/t/sw.js"]) {
    assert.equal(isSwitchablePath(path), false, path);
    assert.equal(screenRedirect(path, q(), true, service), null, path);
  }
  for (const path of ["/t/login", "/t/manifest.webmanifest", "/t/sw.js", "/t/offline", "/t/icon/192"]) assert.equal(isTabletPublicPath(path), true, path);
  for (const path of ["/t/tables", "/t/order/o1", "/t"]) assert.equal(isTabletPublicPath(path), false, path);
});
