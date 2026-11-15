// Restaurant Reports, Step 8: voids & discounts — the reason without the
// approver, a discount's share of the bill against the limit, the totals,
// and the Audit log links.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { auditHref, discountAsked, discountShare, overLimit, voidReason, voidsTotals } from "../lib/reportVoids";

describe("Voids & discounts", () => {
  test("a void's reason without its approver (it has its own column)", () => {
    assert.equal(voidReason("Wrong item · approved by Mona"), "Wrong item");
    assert.equal(voidReason("Guest changed their mind"), "Guest changed their mind");
    assert.equal(voidReason(null), null);
  });

  test("a discount's share of the bill's items, against the limit", () => {
    assert.equal(discountShare("11.00", "110.00"), 10);
    assert.equal(discountShare("15.00", "100.00"), 15);
    assert.equal(discountShare("5", "0"), null);
    assert.deepEqual([overLimit(10, "10"), overLimit(10.1, "10"), overLimit(null, "10")], [false, true, false], "at the limit is fine");
    assert.deepEqual([discountAsked("PERCENT", "12.50"), discountAsked("PERCENT", "10"), discountAsked("AMOUNT", "5")], ["12.5%", "10%", "₦5.00"]);
  });

  test("the totals", () => {
    assert.deepEqual(voidsTotals({ voids: { count: 3, value: "45.5", approved: 1 }, discounts: { count: 2, amount: "16", approved: 1 }, overLimit: 1 }), {
      voids: 3,
      voidValue: "45.50",
      voidsApproved: 1,
      discounts: 2,
      discountAmount: "16.00",
      discountsApproved: 1,
      overLimit: 1,
    });
  });

  test("the Audit log: these days, one kind, maybe one person", () => {
    const range = { from: "2026-11-01", to: "2026-11-07" };
    assert.equal(auditHref(range, "VOID"), "/settings/restaurant/audit?from=2026-11-01&to=2026-11-07&type=VOID");
    assert.equal(auditHref(range, "OVERRIDE", "u1"), "/settings/restaurant/audit?from=2026-11-01&to=2026-11-07&type=OVERRIDE&user=u1");
  });
});
