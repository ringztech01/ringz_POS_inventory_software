// Restaurant Reports, Step 7: the waste strip (with the dashboard's amber /
// red lines), shares, days and the links to Food › Waste.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatQuantity, wasteByDay, wasteHref, wasteKpis, withShares } from "../lib/reportWaste";

const BY_REASON = [
  { reason: "BURNT" as const, count: 3, cost: "30.00" },
  { reason: "EXPIRED" as const, count: 1, cost: "50.00" },
  { reason: "DROPPED" as const, count: 0, cost: "0" },
];

describe("Waste", () => {
  test("cost, entries, top reason; % of food cost against the amber and red lines", () => {
    assert.deepEqual(wasteKpis({ byReason: BY_REASON, foodCost: "2000", amber: "5", red: "10" }), { total: "80.00", entries: 4, topReason: "EXPIRED", share: 4, level: "ok" });
    assert.equal(wasteKpis({ byReason: BY_REASON, foodCost: "1000", amber: "5", red: "10" }).level, "amber", "8%");
    assert.equal(wasteKpis({ byReason: BY_REASON, foodCost: "500", amber: "5", red: "10" }).level, "red", "16%");
    assert.deepEqual(wasteKpis({ byReason: BY_REASON, foodCost: null, amber: "5", red: "10" }).share, null, "no View Cost: not worked out");
    assert.deepEqual(wasteKpis({ byReason: [], foodCost: "100", amber: "5", red: "10" }), { total: "0.00", entries: 0, topReason: null, share: 0, level: "ok" });
  });

  test("each row's share of the waste; every day of the period", () => {
    assert.deepEqual(withShares([{ cost: "30" }, { cost: "50" }, { cost: "0" }]).map((r) => r.share), [37.5, 62.5, 0]);
    assert.deepEqual(withShares([{ cost: "0" }]).map((r) => r.share), [null]);
    assert.deepEqual(wasteByDay({ from: "2026-11-01", to: "2026-11-03" }, [{ day: "2026-11-02", cost: "12.5" }]), [
      { day: "2026-11-01", total: "0.00" },
      { day: "2026-11-02", total: "12.50" },
      { day: "2026-11-03", total: "0.00" },
    ]);
  });

  test("a row opens Food › Waste with its filters", () => {
    const range = { from: "2026-11-01", to: "2026-11-07" };
    assert.equal(wasteHref(range, { reason: "BURNT" }), "/restaurant/food/waste?from=2026-11-01&to=2026-11-07&reason=BURNT");
    assert.equal(wasteHref(range, { user: "u1" }), "/restaurant/food/waste?from=2026-11-01&to=2026-11-07&user=u1");
    assert.equal(wasteHref(range, { q: "Jollof rice" }), "/restaurant/food/waste?from=2026-11-01&to=2026-11-07&q=Jollof+rice");
  });

  test("quantities", () => {
    assert.equal(formatQuantity("2.500", "kg"), "2.5 kg");
    assert.equal(formatQuantity("3", ""), "3");
  });
});
