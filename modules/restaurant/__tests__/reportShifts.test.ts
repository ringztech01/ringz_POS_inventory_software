// Restaurant Reports, Step 9: shifts (hours, net sales, handovers) and
// cash-ups (expected cash, variance, the limit), and the report settings.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shiftLines, tillLines, varianceText, type TillRow } from "../lib/reportShifts";
import { reportSettingsSchema } from "../schemas/reports";

const at = (iso: string) => new Date(iso);

describe("Shifts", () => {
  test("hours (an open one up to now), net sales, handovers; the totals", () => {
    const { lines, totals } = shiftLines(
      [
        { id: "a", userId: "ada", name: "Ada", role: "Waiter", startedAt: at("2026-11-10T08:00:00Z"), endedAt: at("2026-11-10T16:30:00Z"), autoEnded: false, orders: 12, sales: "600.00", refunds: "20.00", handedOver: 2, handedTo: "Tayo" },
        { id: "b", userId: "tayo", name: "Tayo", role: "Waiter", startedAt: at("2026-11-10T16:00:00Z"), endedAt: null, autoEnded: false, orders: 3, sales: "90.00", refunds: "0", handedOver: 0, handedTo: null },
      ],
      at("2026-11-10T18:00:00Z"),
    );
    assert.deepEqual(lines.map((l) => [l.seconds, l.net]), [[30600, "580.00"], [7200, "90.00"]]);
    assert.deepEqual(totals, { shifts: 2, seconds: 37800, orders: 15, net: "670.00", handedOver: 2 });
  });
});

describe("Cash-up", () => {
  const till = (over: Partial<TillRow>): TillRow => ({
    id: "s",
    deviceId: "d",
    device: "Till 1",
    openedBy: "Ada",
    closedBy: null,
    openedAt: at("2026-11-10T08:00:00Z"),
    closedAt: null,
    float: "5000.00",
    cashSales: "12000.00",
    cashTips: "500.00",
    cashRefunds: "1500.00",
    drawerOpens: 9,
    drawerByHand: 1,
    counted: null,
    storedExpected: null,
    storedVariance: null,
    zPrinted: false,
    ...over,
  });

  test("an open till: expected so far (float + cash sales + cash tips − cash refunds), no variance", () => {
    const [l] = tillLines([till({})], "500").lines;
    assert.deepEqual([l.open, l.expected, l.variance, l.overLimit], [true, "16000.00", null, false]);
  });

  test("a closed one keeps its figures as counted; red when out by more than the limit, either way", () => {
    const closed = (counted: string, variance: string) => till({ closedAt: at("2026-11-10T22:00:00Z"), counted, storedExpected: "16000.00", storedVariance: variance });
    const { lines, totals } = tillLines([closed("16000.00", "0.00"), closed("15400.00", "-600.00"), closed("16500.00", "500.00")], "500");
    assert.deepEqual(lines.map((l) => [l.variance, l.overLimit]), [["0.00", false], ["-600.00", true], ["500.00", false]], "exactly the limit isn't over");
    assert.deepEqual([totals.tills, totals.cashSales, totals.drawerOpens, totals.variance, totals.overLimit], [3, "36000.00", 27, "-100.00", 1]);
  });

  test("the variance in words", () => {
    const money = (v: string) => `₦${v}`;
    assert.deepEqual([varianceText("0.00", money), varianceText("12.50", money), varianceText("-300.00", money), varianceText(null, money)], ["Balanced", "₦12.50 over", "₦300.00 short", "—"]);
  });
});

describe("Report settings", () => {
  test("the day start and the cash variance limit", () => {
    assert.ok(reportSettingsSchema.safeParse({ minutes: 240, varianceLimit: "500" }).success);
    assert.ok(reportSettingsSchema.safeParse({ minutes: 0, varianceLimit: "1250.50" }).success);
    assert.equal(reportSettingsSchema.safeParse({ minutes: 0, varianceLimit: "-5" }).error?.issues[0]?.message, "Enter an amount like 500 or 1250.50.");
    assert.equal(reportSettingsSchema.safeParse({ minutes: 15, varianceLimit: "500" }).error?.issues[0]?.message, "Pick one of the times.");
  });
});
