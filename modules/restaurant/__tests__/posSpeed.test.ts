// Run with: npx tsx --test modules/restaurant/__tests__/posSpeed.test.ts
// The touch POS's speed tools (lib/posSpeed.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { withCheck } from "../lib/orderLines";
import { asQuantity, findByCode, heldGroups, kitchenNote, placeLabel, searchDishes, sendChoices, sendsInOneGo, staffBadge, typeDigit } from "../lib/posSpeed";

test("a line's place on the check and the kitchen ticket", () => {
  assert.deepEqual([placeLabel(2, "MAIN"), placeLabel(2, null), placeLabel(null, "STARTER"), placeLabel(null, null)], ["Seat 2 · Main", "Seat 2", "Starter", ""]);
  assert.equal(kitchenNote(3, "DESSERT", "no nuts"), "Seat 3 · Dessert — no nuts");
  assert.equal(kitchenNote(null, null, "no nuts"), "no nuts");
  assert.equal(kitchenNote(null, null, null), null);
});

test("Send: all waiting lines not held, and each course; held lines by course for Fire", () => {
  const L = (id: string, course: "STARTER" | "MAIN" | "DESSERT" | null, held = false, waiting = true) => ({ id, course, held, waiting });
  const lines = [L("a", "STARTER"), L("b", "MAIN", true), L("c", "MAIN"), L("d", null), L("e", "DESSERT", false, false), L("f", null, true)];
  assert.deepEqual(sendChoices(lines), { all: ["a", "c", "d"], courses: [{ course: "STARTER", lineIds: ["a"] }, { course: "MAIN", lineIds: ["c"] }] });
  assert.deepEqual(heldGroups(lines), [{ course: "MAIN", lineIds: ["b"] }, { course: null, lineIds: ["f"] }]);
  assert.deepEqual(sendChoices([L("x", null)]).courses, [], "no courses: Send sends straight away");
});

test("Send in one go: nothing held, one course or none — counting dishes still saving", () => {
  const L = (id: string, course: "STARTER" | "MAIN" | null, held = false, waiting = true) => ({ id, course, held, waiting });
  assert.equal(sendsInOneGo([L("a", null), L("b", null)]), true, "no courses");
  assert.equal(sendsInOneGo([L("a", "MAIN"), L("b", "MAIN"), L("s", "STARTER", false, false)]), true, "one course (sent lines don't count)");
  assert.equal(sendsInOneGo([L("a", null), L("b", "MAIN")]), false, "a course and lines with none: a choice");
  assert.equal(sendsInOneGo([L("a", null), L("h", null, true)]), false, "something held: the Send panel");
  assert.equal(sendsInOneGo([], [null, null, null, null]), true, "a new order, every dish still saving: straight away");
  assert.equal(sendsInOneGo([L("a", null)], [null]), true, "saved and saving, no courses");
  assert.equal(sendsInOneGo([L("a", "MAIN")], ["STARTER"]), false, "a saving dish in another course: a choice");
  assert.equal(sendsInOneGo([], []), false, "nothing to send");
});

test("a dish by code: exact (any case), else the one whose digits match", () => {
  const items = [{ code: "DM-301" }, { code: "DM-302" }, { code: "BEER-1" }, { code: "X1" }, { code: "STAR" }];
  assert.equal(findByCode(items, "dm-301")?.code, "DM-301");
  assert.equal(findByCode(items, "302")?.code, "DM-302");
  assert.equal(findByCode(items, "star")?.code, "STAR");
  assert.equal(findByCode(items, "1"), null, "BEER-1 and X1 both: ambiguous");
  assert.equal(findByCode(items, "999"), null);
  assert.equal(findByCode(items, " "), null);
});

test("quick search: every word in the name or code; names starting with it first", () => {
  const items = [{ name: "Fried Rice & Turkey", code: "DM-302" }, { name: "Jollof Rice & Chicken", code: "DM-301" }, { name: "Rice Pudding", code: "DM-604" }, { name: "Star Lager", code: "DM-901" }];
  assert.deepEqual(searchDishes(items, "rice").map((i) => i.code), ["DM-604", "DM-302", "DM-301"]);
  assert.deepEqual(searchDishes(items, "rice chick").map((i) => i.code), ["DM-301"]);
  assert.deepEqual(searchDishes(items, "dm-90").map((i) => i.code), ["DM-901"]);
  assert.deepEqual(searchDishes(items, "  "), []);
});

test("the Qty keypad: digits only, a leading 0 replaced, 1–99 as a quantity", () => {
  assert.equal(["3", "0", "1"].reduce((v, d) => typeDigit(v, d), ""), "301");
  assert.equal(typeDigit("0", "4"), "4");
  assert.equal(typeDigit("12", "x"), "12");
  assert.deepEqual([asQuantity("3"), asQuantity("0"), asQuantity("100"), asQuantity("")], [3, null, null, null]);
});

test("who's on the till: initials and a short name (the header and the PIN screen)", () => {
  assert.deepEqual(staffBadge("Ada Okafor"), { initials: "AO", short: "Ada O." });
  assert.deepEqual(staffBadge("System"), { initials: "S", short: "System" });
  assert.deepEqual(staffBadge("  chidi   nwosu  eze "), { initials: "CN", short: "chidi E." });
  assert.deepEqual(staffBadge(""), { initials: "?", short: "" });
});

test("a separate check's label after its table: the name, else its number past the first", () => {
  assert.equal(withCheck("5", { checkNumber: 1, checkName: null }), "5");
  assert.equal(withCheck("5", { checkNumber: 2, checkName: null }), "5 · Check 2");
  assert.equal(withCheck("5", { checkNumber: 3, checkName: "Ada" }), "5 · Ada");
  assert.equal(withCheck("5", { checkNumber: null, checkName: null }), "5");
});
