// Run with: npx tsx --test modules/restaurant/__tests__/staffPins.test.ts
// Part 6f Step 3, without a database: the PIN rules (4 digits, the weak ones
// refused), a generated PIN, display names, the placeholder login — and,
// from the source, that only an Administrator manages staff on the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultDisplayName, generatePin, isPinOnlyEmail, pinProblem, weakPinReason } from "../lib/staffPins";

test("weak PINs: the spec's (1234, 0000, 1111, 2580), repeated digits, digits in a row, ABAB — refused", () => {
  for (const pin of ["1234", "0000", "1111", "2580", "9999", "3456", "9876", "8901", "1212", "4747", "0852"]) assert.ok(weakPinReason(pin), pin);
  for (const pin of ["3917", "5082", "1357", "2468", "7130"]) assert.equal(weakPinReason(pin), null, pin);
  assert.equal(pinProblem("1234", { allowWeak: false }), "That PIN is too easy to guess (one of the PINs people guess first). Pick another.");
  assert.equal(pinProblem("1234", { allowWeak: true }), null, "the Administrator's setting allows them");
});

test("exactly 4 digits", () => {
  for (const pin of ["123", "12345", "12a4", "", " 391"]) assert.equal(pinProblem(pin, { allowWeak: true }), "A PIN is 4 digits.", JSON.stringify(pin));
  assert.equal(pinProblem("3917", { allowWeak: false }), null);
});

test("a generated PIN: 4 digits, never weak, never one that's taken", async () => {
  const taken = new Set(["3917"]);
  const seq = [0.1234, 0.3917, 0.5082]; // 1234 weak → 3917 taken → 5082
  let i = 0;
  assert.equal(await generatePin(async (p) => taken.has(p), () => seq[i++]), "5082");
  for (let n = 0; n < 200; n++) {
    const pin = await generatePin(async () => false, Math.random);
    assert.ok(pin && /^\d{4}$/.test(pin) && !weakPinReason(pin), String(pin));
  }
  assert.equal(await generatePin(async () => true, Math.random, 5), null, "everything taken: none");
});

test("display names and the placeholder login", () => {
  assert.equal(defaultDisplayName("Ada", "Okafor"), "Ada O.");
  assert.equal(defaultDisplayName(" Ada ", ""), "Ada");
  assert.ok(isPinOnlyEmail("staff-1a2b@pin.local"));
  assert.ok(!isPinOnlyEmail("ada@example.com"));
});

const src = (file: string) => readFileSync(file, "utf8");

test("on the server: every staff action but 'my own PIN' is the Administrator's", () => {
  const actions = src("modules/restaurant/server/actions/staff.ts");
  const chunks = actions.split(/\nexport async function /).slice(1);
  const names = chunks.map((c) => c.slice(0, c.indexOf("(")));
  assert.deepEqual(names, ["createStaff", "updateStaff", "setStaffPin", "disableStaff", "enableStaff", "saveStaffSettings", "changeOwnPin"]);
  for (const chunk of chunks.slice(0, 6)) assert.match(chunk, /const admin = await requireAdministrator\(\);\s*if \(admin\.error !== undefined\) return/, chunk.slice(0, 30));
  assert.match(src("modules/restaurant/pages/StaffPage.tsx"), /await requireRestaurant\(\);\s*if \(!\(await isSystemAdmin\(await getCurrentUserPermissions\(\)\)\)\) return <ForbiddenState/);
});

test("Peoples › Users is the Administrator's while the module is on; sign-in refuses disabled and PIN-only people; a reset ends sessions", () => {
  const users = src("app/(dashboard)/peoples/users/actions.ts");
  assert.equal((users.match(/const adminProblem = await restaurantAdminProblem\(\);\s*if \(adminProblem\) return/g) ?? []).length, 3);
  const auth = src("auth.ts");
  assert.match(auth, /if \(!user \|\| user\.disabledAt \|\| user\.pinOnly\) return null;/);
  assert.match(auth, /if \(!user \|\| user\.disabledAt\) return null;/);
  assert.match(auth, /now\.sessionVersion !== \(token\.sv \?\? 0\)\)\)\) return null;/);
  const service = src("modules/restaurant/server/services/staff.ts");
  assert.match(service, /if \(reset\) await tx\.user\.update\(\{ where: \{ id: input\.id \}, data: \{ sessionVersion: \{ increment: 1 \} \} \}\);/);
  assert.match(service, /disabledAt: new Date\(\), sessionVersion: \{ increment: 1 \}/);
  assert.doesNotMatch(src("modules/restaurant/server/actions/bill.ts"), /export async function saveApprovalPin/, "the old 'set your own PIN freely' action is gone");
});
