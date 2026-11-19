// Run with: npx tsx --test modules/restaurant/__tests__/tabletPay.test.ts
// 6g follow-up 1: the tablet PAY's own rules (lib/tabletPay.ts) — the tip
// choices, the keypad, mixing methods, when the bill can still change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addMethod, billOpen, keyed, leftFor, setMethod, TABLET_DISCOUNT_REASONS, TABLET_METHODS, TABLET_SPLIT_WAYS, tipFor, type PayRow } from "../lib/tabletPay";
import { tender } from "../lib/tender";
import { orderDiscountSchema, splitBillSchema } from "../schemas/bill";

test("tips: 5, 10 and 15% of what's due, to the naira", () => {
  assert.equal(tipFor("12000.00", 10), "1200.00");
  assert.equal(tipFor("17.11", 10), "2.00", "₦1.71 rounds to ₦2");
  assert.equal(tipFor("8450.00", 15), "1268.00");
  assert.equal(tipFor("0", 5), "0.00");
});

test("the keypad: digits and 00, no leading zeros, ⌫, the first key replaces", () => {
  assert.equal(keyed("", "5", false), "5");
  assert.equal(keyed("5", "00", false), "500");
  assert.equal(keyed("0", "7", false), "7");
  assert.equal(keyed("500", "⌫", false), "50");
  assert.equal(keyed("12000.00", "3", true), "3", "fresh: the first key replaces");
  assert.equal(keyed("123456789", "1", false), "123456789", "at most 9 digits");
  assert.equal(keyed("12", "CLEAR", false), "12", "anything else is ignored");
});

test("mixing methods: what's left for each, another method, swapping", () => {
  const rows: PayRow[] = [{ paymentType: "CARD", amount: "5000" }];
  assert.equal(leftFor("12000.00", rows, 0), "12000.00", "the row itself isn't counted");
  const two = addMethod("12000.00", rows);
  assert.deepEqual(two, [{ paymentType: "CARD", amount: "5000" }, { paymentType: "CASH", amount: "7000.00" }], "the first method not used, for the rest");
  assert.equal(leftFor("12000.00", two!, 1), "7000.00");
  const three = addMethod("12000.00", two!);
  assert.equal(three?.[2].paymentType, "BANK_TRANSFER");
  assert.equal(three?.[2].amount, "0.00", "nothing left to pay");
  assert.equal(addMethod("12000.00", three!), null, "three methods at most: cash, card, transfer");
  assert.deepEqual(setMethod(two!, 0, "CASH").map((r) => r.paymentType), ["CASH", "CARD"], "a method already used swaps");
  assert.deepEqual(setMethod(two!, 1, "BANK_TRANSFER").map((r) => r.paymentType), ["CARD", "BANK_TRANSFER"]);
  assert.equal(leftFor("100", [{ paymentType: "CASH", amount: "150" }, { paymentType: "CARD", amount: "0" }], 1), "0.00", "never below 0");
});

test("a mixed payment adds up the till's way (lib/tender): change only from cash", () => {
  const ok = tender("12000.00", "1200.00", [{ paymentType: "CARD", amount: "5000" }, { paymentType: "CASH", amount: "10000" }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.change.toFixed(2), "1800.00", "₦13,200 owed with the tip; ₦15,000 handed over");
  const over = tender("12000.00", "0", [{ paymentType: "CARD", amount: "13000" }]);
  assert.equal(over.ok, false, "card can't be more than owed");
  const short = tender("12000.00", "0", [{ paymentType: "BANK_TRANSFER", amount: "4000" }, { paymentType: "CASH", amount: "4000" }]);
  assert.equal(short.ok, false);
});

test("the tablet's choices fit the server's rules", () => {
  assert.deepEqual([...TABLET_METHODS], ["CASH", "CARD", "BANK_TRANSFER"], "no cheques on a tablet");
  assert.deepEqual([...TABLET_SPLIT_WAYS], [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const ways of TABLET_SPLIT_WAYS) assert.equal(splitBillSchema.safeParse({ orderId: "o1", version: 1, split: { mode: "EQUAL", ways } }).success, true, `${ways} ways`);
  for (const reason of TABLET_DISCOUNT_REASONS) assert.equal(orderDiscountSchema.safeParse({ orderId: "o1", version: 1, type: "PERCENT", value: "10", reason, approval: { approverId: "u1", pin: "1234" } }).success, true, reason);
  assert.equal(orderDiscountSchema.safeParse({ orderId: "o1", version: 1, type: "PERCENT", value: "0", reason: "", approval: { approverId: "u1", pin: "1234" } }).success, true, "removing it: no reason needed");
});

test("split or discount only while nothing of the bill is paid", () => {
  assert.equal(billOpen(null), true);
  assert.equal(billOpen({ parts: [{ status: "OPEN" }, { status: "OPEN" }] }), true);
  assert.equal(billOpen({ parts: [{ status: "PAID" }, { status: "OPEN" }] }), false);
});
