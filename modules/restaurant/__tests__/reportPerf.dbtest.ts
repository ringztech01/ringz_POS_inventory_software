// Restaurant Reports, Step 11: how long each tab's queries take on 90 days
// of data — about 50,000 settled orders, with their lines, sales, payments,
// tips, refunds, voids, waste, shifts, tills and drawer opens — on this PC.
// Opt-in (REPORT_PERF=1) and only on a throwaway copy: it seeds a lot.
//
//   REPORT_PERF=1 RESTAURANT_DB_TEST=1 DATABASE_URL=mysql://…/<name>_restaurant_check \
//     npx tsx --tsconfig modules/restaurant/__tests__/tsconfig.dbtest.json \
//       --test modules/restaurant/__tests__/reportPerf.dbtest.ts
//
// Each tab is timed as its page loads it: the shell (filter choices, the
// settled-order count) then the tab's own query; a warm-up, then the median
// of five. Every tab must come in under a second.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { businessDay, parseReportFilters, type ReportFilters } from "../server/queries/reports/filters";
import { countSettledOrders, getReportSetup } from "../server/queries/reports/shell";
import { getOverview } from "../server/queries/reports/overview";
import { getDishReport } from "../server/queries/reports/dishes";
import { getWaiterReport } from "../server/queries/reports/waiters";
import { getOrderTypeReport, getTableReport } from "../server/queries/reports/tables";
import { getPaymentsReport } from "../server/queries/reports/payments";
import { getWasteReport } from "../server/queries/reports/waste";
import { getVoidsReport } from "../server/queries/reports/voids";
import { getShiftsReport } from "../server/queries/reports/shifts";
import { DAYS, seedReportPerf } from "./reportPerf.seed";

const database = new URL(process.env.DATABASE_URL ?? "mysql://x/none").pathname.slice(1);
// Timed runs a tab, after a warm-up (REPORT_PERF_RUNS, default 5).
const RUNS = Math.max(1, Number(process.env.REPORT_PERF_RUNS ?? 5) || 5);
const enabled = process.env.REPORT_PERF === "1" && process.env.RESTAURANT_DB_TEST === "1" && database.endsWith("_restaurant_check");

// An already-seeded copy (a profiling run kept it): its period.
async function seededRange() {
  const span = await prisma.order.aggregate({ where: { id: { startsWith: "perf_o_" } }, _min: { closedAt: true }, _max: { closedAt: true } });
  const day = (d: Date | null) => businessDay(d ?? new Date(), 0);
  return { from: day(span._min.closedAt), to: day(span._max.closedAt) };
}

describe("Reports performance: 90 days, ~50,000 orders (database copy)", { skip: enabled ? false : "set REPORT_PERF=1 and RESTAURANT_DB_TEST=1, on a *_restaurant_check database" }, () => {
  let range = { from: "", to: "" };
  before(async () => {
    const started = Date.now();
    range = (await prisma.order.count({ where: { id: { startsWith: "perf_o_" } } })) ? await seededRange() : await seedReportPerf();
    const counts = await prisma.$queryRawUnsafe<{ orders: unknown; items: unknown }[]>(`SELECT (SELECT COUNT(*) FROM \`Order\` WHERE id LIKE 'perf_o_%') AS orders, (SELECT COUNT(*) FROM OrderItem WHERE id LIKE 'perf_i%') AS items`);
    console.log(`seeded ${counts[0].orders} orders, ${counts[0].items} lines, ${range.from} → ${range.to}, in ${Math.round((Date.now() - started) / 1000)} s`);
  });
  after(() => prisma.$disconnect());

  test("each tab loads in under a second (its page's queries: the shell, then the tab's own)", async () => {
    const window = parseReportFilters(range, { dayStartMinutes: 0 }).window;
    assert.equal(window.days, DAYS);
    const none: ReportFilters = { area: null, waiter: null, type: null, station: null, device: null };
    const shell = async (f: ReportFilters) => {
      const setup = await getReportSetup();
      assert.ok(setup.ok);
      const count = await countSettledOrders(window, f);
      assert.ok(count.ok);
      return count.data;
    };
    const tabs: [string, (f: ReportFilters) => Promise<{ ok: boolean }>][] = [
      ["Overview", (f) => getOverview(window, f, { dayStartMinutes: 0, withCost: true })],
      ["By dish", (f) => getDishReport(window, f, { withCost: true })],
      ["By waiter", (f) => getWaiterReport(window, f)],
      ["By table", (f) => getTableReport(window, f)],
      ["By order type", (f) => getOrderTypeReport(window, f)],
      ["Payments & tips", (f) => getPaymentsReport(window, f)],
      ["Waste", () => getWasteReport(window, { dayStartMinutes: 0, withCost: true })],
      ["Voids & discounts", (f) => getVoidsReport(window, f)],
      ["Shifts & cash-up", (f) => getShiftsReport(window, f)],
    ];
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const results: { tab: string; all: number; waiter: number }[] = [];
    for (const [tab, load] of tabs) {
      const time = async (f: ReportFilters) => {
        const runs: number[] = [];
        for (let i = 0; i <= RUNS; i++) {
          const t0 = performance.now();
          await shell(f);
          const r = await load(f);
          assert.ok(r.ok, tab);
          if (i > 0) runs.push(performance.now() - t0);
        }
        return Math.round(median(runs));
      };
      results.push({ tab, all: await time(none), waiter: await time({ ...none, waiter: "perf_u_3" }) });
    }
    const orders = await shell(none);
    console.log(`\n90 days, ${orders} settled orders (no filter) — median of ${RUNS} after a warm-up, ms:`);
    for (const r of results) console.log(`  ${r.tab.padEnd(20)} ${String(r.all).padStart(6)}   (one waiter: ${r.waiter})`);
    for (const r of results) assert.ok(r.all < 1000 && r.waiter < 1000, `${r.tab}: ${r.all} ms / ${r.waiter} ms`);
  });
});
