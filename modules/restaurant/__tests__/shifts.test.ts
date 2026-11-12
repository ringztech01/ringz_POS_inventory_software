// Run with: npx tsx --test modules/restaurant/__tests__/shifts.test.ts
// Part 6f Step 6, without a database: the shift rules (on shift = a shift
// started today on the app's calendar; one left open from an earlier day is
// stale), and — from the source — LOCK ending the session on a PIN terminal,
// auto-lock waiting for a payment, the user chip on a terminal, overrides
// logged against both people, and a session tied to its device.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asksToStart, shiftState, startOfAppDay } from "../lib/shifts";

test("the app's day starts at midnight in Lagos (UTC+1)", () => {
  assert.equal(startOfAppDay(new Date("2026-11-11T12:00:00Z")).toISOString(), "2026-11-10T23:00:00.000Z");
  assert.equal(startOfAppDay(new Date("2026-11-11T23:30:00Z")).toISOString(), "2026-11-11T23:00:00.000Z", "after 23:00 UTC it's already tomorrow in Lagos");
});

test("on shift: a shift started today; one from yesterday is stale; none is off — and only then is Start shift? asked", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  assert.equal(shiftState({ startedAt: new Date("2026-11-11T07:00:00Z") }, now), "ON");
  assert.equal(shiftState({ startedAt: new Date("2026-11-10T22:59:00Z") }, now), "STALE", "11:59 pm yesterday in Lagos");
  assert.equal(shiftState(null, now), "OFF");
  assert.equal(asksToStart(true, "OFF"), true);
  assert.equal(asksToStart(true, "STALE"), true);
  assert.equal(asksToStart(true, "ON"), false);
  assert.equal(asksToStart(false, "OFF"), false, "clock in / out off: never asked");
});

const src = (file: string) => readFileSync(file, "utf8");

test("LOCK: on a PIN terminal the session ends (the PIN screen); elsewhere the screen locks; End shift? first when on shift", () => {
  const action = src("modules/restaurant/server/actions/session.ts");
  assert.match(action, /if \(!\(await pinTerminalId\(\)\)\) \{[\s\S]*?return \{ ok: true as const, signedOut: false, transferred \};\s*\}\s*await signOut\(\{ redirect: false \}\);/);
  const session = src("modules/restaurant/components/pos/PosSession.tsx");
  assert.match(session, /if \(result\.signedOut\) return void window\.location\.replace\("\/"\);/);
  assert.match(session, /if \(shift\.clockOn && shift\.onShift\) return setShiftPrompt\("end"\);/);
  assert.match(session, /openSwitch: terminal \? lock : \(\) => setSwitching\(true\)/, "the user chip on a terminal ends the session too");
  assert.match(session, /if \(result\.askShift\) setShiftPrompt\("start"\);/);
});

test("auto-lock: never during a payment; managers have their own time; Never stays never", () => {
  const session = src("modules/restaurant/components/pos/PosSession.tsx");
  assert.match(session, /if \(holds\.current\.size > 0\) \{\s*timer = setTimeout\(fire, lockSeconds \* 1000\);\s*return;\s*\}/);
  const order = src("modules/restaurant/components/pos/OrderPos.tsx");
  assert.match(order, /const paying = popup\?\.kind === "bill" \|\| popup\?\.kind === "split" \|\| popup\?\.kind === "pay" \|\| popup\?\.kind === "refund" \|\| !!settled;/);
  assert.match(order, /holdAutoLock\("pay", paying\);/);
  const info = src("modules/restaurant/server/posSessionInfo.ts");
  assert.match(info, /const lockSeconds = settings\.lockSeconds === 0 \? 0 : current\.serviceOnly \? settings\.lockSeconds : settings\.lockSecondsManager;/);
});

test("manager overrides: logged against both people, once the change is made", () => {
  const pins = src("modules/restaurant/server/services/approvalPins.ts");
  assert.match(pins, /action: `override\.\$\{input\.kind\}`[\s\S]*?approvedById: input\.approverId/);
  assert.match(pins, /userId: input\.approverId, action: `override\.\$\{input\.kind\}\.approve`[\s\S]*?forUserId: input\.actorId/);
  for (const [file, kind] of [
    ["modules/restaurant/server/services/orderFlow.ts", "void"],
    ["modules/restaurant/server/services/refund.ts", "refund"],
    ["modules/restaurant/server/services/bill.ts", "discount"],
    ["modules/restaurant/server/services/waste.ts", "waste"],
    ["modules/restaurant/server/actions/pos.ts", "drawer"],
  ])
    assert.match(src(file), new RegExp(`logOverride\\(tx, \\{ kind: "${kind}"`), file);
});

test("handover (Step 7a): End shift with open tables asks who takes them first", () => {
  const action = src("modules/restaurant/server/actions/session.ts");
  assert.match(action, /const ended = await endShift\(me\.userId, deviceId, new Date\(\), \{ transferTo \}\);\s*if \(!ended\.ok\) return ended;/);
  const session = src("modules/restaurant/components/pos/PosSession.tsx");
  assert.match(session, /if \(!result\.ok && result\.needsHandover\) return void setHandover\(result\.needsHandover\);/);
  assert.match(session, /<HandoverDialog handover=\{handover\} busy=\{shiftBusy\} onHand=\{\(toId\) => void lockNow\(true, toId\)\}/);
});

test("a session is tied to its device: the same cookie on another browser ends it", () => {
  const auth = src("auth.ts");
  assert.match(auth, /token\.did = \(await deviceNow\(\)\) \?\? null;/);
  assert.match(auth, /if \(token\.did && device !== token\.did\) return null;/);
});
