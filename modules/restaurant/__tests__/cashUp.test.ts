// Run with: npx tsx --test modules/restaurant/__tests__/cashUp.test.ts
// Part 6f Step 7b, without a database: the cash-up sums (expected cash, the
// variance and its label, a typed amount), the Z-report's rows and bytes,
// and — from the source — every payment path handing its open till on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expectedCash, parseCash, variance, varianceLabel } from "../lib/cashUp";
import { zReport, type TillSummary } from "../lib/zReport";
import { renderTicket } from "../../../lib/hardware/tickets";

test("expected cash = float + cash taken + cash tips − cash refunds; the variance is counted − expected", () => {
  assert.equal(expectedCash({ float: "10000", cashSales: "52500.50", cashTips: "1500", cashRefunds: "2500" }).toFixed(2), "61500.50");
  assert.equal(variance("61000", "61500.50").toFixed(2), "-500.50");
  assert.equal(varianceLabel("-500.50"), "Short ₦500.50");
  assert.equal(varianceLabel("200"), "Over ₦200.00");
  assert.equal(varianceLabel("0"), "Balanced");
});

test("a typed amount: naira, commas and ₦ fine, two decimals at most, nothing below 0 or over ₦10m", () => {
  assert.equal(parseCash("25,000")?.toFixed(2), "25000.00");
  assert.equal(parseCash("₦1,000.5")?.toFixed(2), "1000.50");
  assert.equal(parseCash("0")?.toFixed(2), "0.00");
  for (const bad of ["", "-5", "1.234", "abc", "20000000", null]) assert.equal(parseCash(bad), null, String(bad));
});

const summary: TillSummary = {
  id: "s1",
  openedBy: "Ada C.",
  openedAt: "2026-11-11T08:00:00.000Z",
  closedBy: "Tunde C.",
  closedAt: "2026-11-11T22:00:00.000Z",
  figures: {
    float: "10000.00",
    cashSales: "50.00",
    cashTips: "5.00",
    cashRefunds: "25.00",
    expected: "10030.00",
    byMethod: [
      { method: "CASH", label: "Cash", amount: "50.00", count: 1 },
      { method: "CARD", label: "Card", amount: "0.00", count: 0 },
      { method: "BANK_TRANSFER", label: "Transfer", amount: "120.00", count: 2 },
      { method: "CHEQUE", label: "Cheque", amount: "0.00", count: 0 },
    ],
    tipsByMethod: [
      { method: "CASH", label: "Cash", amount: "5.00" },
      { method: "CARD", label: "Card", amount: "0.00" },
      { method: "BANK_TRANSFER", label: "Transfer", amount: "0.00" },
      { method: "CHEQUE", label: "Cheque", amount: "0.00" },
    ],
    refunds: { count: 1, amount: "25.00" },
    drawerByHand: 2,
  },
  counted: "10000.00",
  variance: "-30.00",
  result: "Short ₦30.00",
  note: null,
  zPrinted: false,
};

test("the Z-report: the cash, takings by method used, tips, refunds, the drawer by hand — and the result", () => {
  const z = zReport("Bar till", summary);
  assert.deepEqual(z.sections.map((s) => s.heading), ["Cash", "Takings", "Also"]);
  assert.deepEqual(z.sections[0].rows.at(-2), ["Expected in drawer", "₦10,030.00"]);
  assert.deepEqual(z.sections[1].rows, [["Cash (1)", "₦50.00"], ["Transfer (2)", "₦120.00"]], "methods with nothing taken are left out (cash always shows)");
  assert.deepEqual(z.sections[2].rows.at(-1), ["Drawer opened by hand", "2"]);
  assert.equal(z.result, "Short ₦30.00");
  const bytes = renderTicket("ZREPORT", z, { paperWidth: 80, codePage: "PC437", cut: "PARTIAL", reprint: null, reroutedFrom: null });
  const text = new TextDecoder("latin1").decode(bytes);
  assert.match(text, /Z-REPORT/);
  assert.match(text, /Bar till/);
  assert.match(text, /Short/);
});

const src = (file: string) => readFileSync(file, "utf8");

test("every payment path hands its open till on — and sends the new column only when there is one", () => {
  const sale = src("app/(dashboard)/sales/save-sale.ts");
  assert.equal((sale.match(/\.\.\.\(tillSessionId \? \{ tillSessionId \} : \{\}\)/g) ?? []).length, 2, "the sale's first payments and later ones");
  assert.match(src("app/(dashboard)/sales/returns/save-return.ts"), /\.\.\.\(tillSessionId \? \{ tillSessionId \} : \{\}\)/);
  const settle = src("modules/restaurant/server/services/settle.ts");
  assert.match(settle, /const tillSessionId = await tillSessionIdFor\(deviceId, tx\);/);
  assert.match(settle, /saveSaleInTx\(tx, sale\.input, userId, \{ moveStock: false, morePayments: sale\.morePayments, tillSessionId \}\)/);
  assert.match(settle, /addSalePaymentsInTx\(tx, saleId, toSalePayments\(plan\.tender\.payments, today, note\), userId, \{ tillSessionId \}\)/);
  assert.match(src("modules/restaurant/server/services/refund.ts"), /tillSessionId: await tillSessionIdFor\(deviceId, tx\)/);
  assert.match(src("modules/restaurant/server/actions/bill.ts"), /settleOrder\(parsed\.data, authCheck\.userId, \{ deviceId: await currentDeviceId\(\) \}\)/);
  assert.match(src("app/(pos)/pos/actions.ts"), /saveNewSale\(input, authCheck\.userId, \{ tillSessionId: await tillSessionIdFor\(deviceId\) \}\)/);
  const actions = src("modules/restaurant/server/actions/till.ts");
  assert.match(actions, /requirePermission\(RESTAURANT_PERMISSIONS\.SETTLE_BILL\)/);
  assert.match(actions, /const deviceId = await currentDeviceId\(\);/, "the till is the device itself");
});
