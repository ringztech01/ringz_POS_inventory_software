// Run with: npx tsx --test modules/restaurant/__tests__/modifiers.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkSelection, groupRuleLabel, mergeKey, type GroupRule } from "../lib/modifiers";
import { linePrice } from "../lib/orderTotals";
import { addLineSchema, lineQuantitySchema } from "../schemas/orderLine";

const portion: GroupRule = { id: "g1", name: "Portion", minSelect: 1, maxSelect: 1, optionIds: ["regular", "large"] };
const extras: GroupRule = { id: "g2", name: "Extras", minSelect: 0, maxSelect: 2, optionIds: ["plantain", "coleslaw", "egg"] };
const groups = [portion, extras];

describe("modifier rules (min / max)", () => {
  test("labels", () => {
    assert.deepEqual(
      [[1, 1], [0, 1], [0, 2], [2, 2], [1, 3]].map(([min, max]) => groupRuleLabel(min, max)),
      ["required", "optional", "up to 2", "pick 2", "pick 1–3"],
    );
  });

  test("a required group must be met", () => {
    assert.equal(checkSelection(groups, []), "Portion: pick one.");
    assert.equal(checkSelection(groups, ["plantain"]), "Portion: pick one.");
    assert.equal(checkSelection(groups, ["large"]), null);
  });

  test("no more than the maximum", () => {
    assert.equal(checkSelection(groups, ["regular", "large"]), "Portion: pick up to 1.");
    assert.equal(checkSelection(groups, ["regular", "plantain", "coleslaw"]), null);
    assert.equal(checkSelection(groups, ["regular", "plantain", "coleslaw", "egg"]), "Extras: pick up to 2.");
  });

  test("at least n, and exactly n", () => {
    assert.equal(checkSelection([{ ...extras, minSelect: 2, maxSelect: 3 }], ["egg"]), "Extras: pick at least 2.");
    assert.equal(checkSelection([{ ...extras, minSelect: 2, maxSelect: 2 }], ["egg"]), "Extras: pick 2.");
  });

  test("options from elsewhere and repeats are refused; no groups means no options", () => {
    assert.equal(checkSelection(groups, ["regular", "chips"]), "That option isn't available for this dish. Pick again.");
    assert.equal(checkSelection(groups, ["regular", "plantain", "plantain"]), "Pick each option once.");
    assert.equal(checkSelection([], []), null);
    assert.equal(checkSelection([], ["regular"]), "That option isn't available for this dish. Pick again.");
  });
});

describe("line price and merging", () => {
  test("the dish price plus its options' price changes (lib/pricing)", () => {
    assert.equal(linePrice("18.00", ["0", "4.00", "2.00"]).toFixed(2), "24.00");
    assert.equal(linePrice("26.00", []).toFixed(2), "26.00");
    assert.equal(linePrice("1.10", ["0.20"]).toFixed(2), "1.30");
  });

  test("same options (any order) and note → same line; a different note or option → a new line", () => {
    assert.equal(mergeKey(["large", "plantain"], "no pepper"), mergeKey(["plantain", "large"], " no pepper "));
    assert.equal(mergeKey([], null), mergeKey([], ""));
    assert.notEqual(mergeKey(["large"], "no pepper"), mergeKey(["large"], "less ice"));
    assert.notEqual(mergeKey(["large"], null), mergeKey(["regular"], null));
  });
});

describe("what the browser may send", () => {
  test("a tampered price is dropped: only dish, options and note get through", () => {
    const parsed = addLineSchema.parse({ orderId: "o1", version: 0, productId: "p1", modifierIds: [], note: "", unitPrice: "0.01", price: 0, taxRate: "0" });
    assert.deepEqual(parsed, { orderId: "o1", version: 0, productId: "p1", modifierIds: [], note: null });
  });

  test("the note is trimmed, empty becomes none, at most 140 characters", () => {
    const base = { orderId: "o1", version: 0, productId: "p1", modifierIds: [] };
    assert.equal(addLineSchema.parse({ ...base, note: "  no pepper " }).note, "no pepper");
    assert.equal(addLineSchema.safeParse({ ...base, note: "x".repeat(140) }).success, true);
    assert.equal(addLineSchema.safeParse({ ...base, note: "x".repeat(141) }).success, false);
  });

  test("quantity 0–99 (0 removes the line)", () => {
    const base = { orderId: "o1", version: 0, lineId: "l1" };
    for (const quantity of [0, 1, 99]) assert.equal(lineQuantitySchema.safeParse({ ...base, quantity }).success, true);
    for (const quantity of [-1, 100, 1.5]) assert.equal(lineQuantitySchema.safeParse({ ...base, quantity }).success, false);
  });
});
