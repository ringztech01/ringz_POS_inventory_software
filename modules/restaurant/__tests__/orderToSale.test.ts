// Run with: npx tsx --test modules/restaurant/__tests__/orderToSale.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KitchenStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { computeLine, computeOrder, sumSubtotals } from "@/lib/pricing";
import { computePaymentState } from "@/lib/payments";
import { salePaymentSchema, saleSchema } from "@/lib/validations/sale";
import { orderToSale, saleNotes, toSalePayments, type OrderForSale, type PaymentIn } from "../lib/orderToSale";
import { orderTotals } from "../lib/orderTotals";
import { splitEqually } from "../lib/billSplit";

type Line = OrderForSale["lines"][number];
const line = (productId: string, quantity: number, unitPrice: string, extra: Partial<Line> = {}): Line => ({
  productId,
  quantity,
  unitPrice,
  taxType: "EXCLUSIVE",
  taxRate: "0",
  kitchenStatus: "SERVED" as KitchenStatus,
  cancelledAt: null,
  deletedAt: null,
  remakeOfId: null,
  ...extra,
});
const order = (lines: Line[], extra: Partial<OrderForSale> = {}): OrderForSale => ({
  ref: "ORD-0073",
  table: "CB1",
  waiter: "Ada",
  type: "DINE_IN",
  warehouseId: "wh1",
  customerId: null,
  lines,
  ...extra,
});
const cash = (amount: string): PaymentIn[] => [{ paymentType: "CASH", amount }];
const OPTIONS = { servicePercent: "10", date: "2026-11-01", walkInCustomerId: "walk-in" };

// What retail's createSale does with the input: saleSchema, then loadDocument's
// pricing (computeLine per line, computeOrder for the total).
function retail(input: unknown) {
  const data = saleSchema.parse(input);
  const itemsTotal = sumSubtotals(data.items.map((item) => computeLine({ ...item, unitCost: item.unitCost ?? "0" }).subtotal));
  const grandTotal = computeOrder({ itemsTotal, taxRate: data.orderTax, discount: data.discount, shipping: data.shipping }).grandTotal;
  assert.ok(!new Decimal(data.discount).greaterThan(itemsTotal), "retail refuses a discount above the items total");
  assert.ok(!new Decimal(data.paidAmount).greaterThan(grandTotal), "retail refuses paid above the total");
  return { data, grandTotal: grandTotal.toFixed(2) };
}
const sale = (o: OrderForSale, payments: PaymentIn[], extra: Partial<Parameters<typeof orderToSale>[1]> = {}) => {
  const result = orderToSale(o, { ...OPTIONS, payments, ...extra });
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result;
};

test("a single line: the sale createSale takes, priced by retail to the bill total", () => {
  const result = sale(order([line("jollof", 1, "18.00")]), cash("19.80"));
  assert.deepEqual(result.input, {
    date: "2026-11-01",
    status: "RECEIVED",
    warehouseId: "wh1",
    customerId: "walk-in",
    orderTax: "0",
    discount: "0.00",
    shipping: "1.80",
    notes: "Restaurant ORD-0073 · Table CB1 · Dine-in · Waiter: Ada",
    paidAmount: "19.80",
    paymentType: "CASH",
    items: [{ productId: "jollof", quantity: 1, unitCost: "18.00", discountType: "FIXED", discount: "0", taxType: "EXCLUSIVE", taxRate: "0", purchaseUnit: "Pic" }],
  });
  assert.deepEqual(result.morePayments, []);
  assert.equal(retail(result.input).grandTotal, "19.80");
  assert.equal(result.rounding.toFixed(2), "0.00");
});

test("modifiers: their price changes are in the line's unit price, not lines of their own", () => {
  // Jollof ₦18 + Extra chicken ₦3 − No pepper ₦0 → the snapshot ₦21.00.
  const result = sale(order([line("jollof", 2, "21.00"), line("zobo", 1, "10.00", { taxRate: "7.5" })]), cash("57.95"));
  assert.deepEqual(
    result.input.items.map((i) => [i.productId, i.quantity, i.unitCost, i.taxRate]),
    [
      ["jollof", 2, "21.00", "0"],
      ["zobo", 1, "10.00", "7.5"],
    ],
  );
  // 42 + 10 + 0.75 tax + 5.20 service.
  assert.equal(retail(result.input).grandTotal, "57.95");
});

test("the same dish on several lines: one sale line (retail lists a product once)", () => {
  // Same price (notes differ): exact.
  const same = sale(order([line("jollof", 1, "18.00"), line("zobo", 1, "10.00"), line("jollof", 2, "18.00")]), cash("0"));
  assert.deepEqual(same.input.items.map((i) => [i.productId, i.quantity, i.unitCost]), [["jollof", 3, "18.00"], ["zobo", 1, "10.00"]]);
  // Different options: the average, exact here.
  const mixed = sale(order([line("jollof", 1, "18.00"), line("jollof", 1, "21.00")]), cash("0"));
  assert.deepEqual(mixed.input.items.map((i) => [i.quantity, i.unitCost]), [[2, "19.50"]]);
  assert.equal(mixed.rounding.toFixed(2), "0.00");
  // Not exact: 18 + 2 × 21.01 = 60.02 over 3 → ₦20.01 each (₦60.03); the kobo goes on the discount.
  const o = order([line("jollof", 1, "18.00"), line("jollof", 2, "21.01")]);
  const odd = sale(o, cash("0"));
  assert.deepEqual([odd.input.items[0].unitCost, odd.rounding.toFixed(2), odd.input.discount], ["20.01", "0.01", "0.01"]);
  assert.equal(retail(odd.input).grandTotal, orderTotals(o.lines, "10").total.toFixed(2));
});

test("discount: the order's, as the sale's discount", () => {
  const lines = [line("jollof", 2, "18.00"), line("zobo", 1, "10.00", { taxRate: "7.5" })];
  const percent = sale(order(lines, { discountType: "PERCENT", discountValue: "10" }), cash("46.29"));
  assert.deepEqual([percent.input.discount, percent.input.shipping, retail(percent.input).grandTotal], ["4.60", "4.14", "46.29"]);
  const amount = sale(order(lines, { discountType: "AMOUNT", discountValue: "6" }), cash("0"));
  assert.deepEqual([amount.input.discount, retail(amount.input).grandTotal], ["6.00", orderTotals(lines, "10", { discountType: "AMOUNT", discountValue: "6" }).total.toFixed(2)]);
  // All of it off: the tax is still paid.
  const all = sale(order(lines, { discountType: "PERCENT", discountValue: "100" }), cash("0.75"));
  assert.deepEqual([all.input.discount, all.input.shipping, retail(all.input).grandTotal], ["46.00", "0.00", "0.75"]);
});

test("service charge: the sale's shipping (untaxed); switched off, none", () => {
  const lines = [line("jollof", 2, "18.00"), line("zobo", 1, "10.00", { taxRate: "7.5" })];
  assert.deepEqual([sale(order(lines), cash("0")).input.shipping, retail(sale(order(lines), cash("0")).input).grandTotal], ["4.60", "51.35"]);
  const off = sale(order(lines, { serviceCharge: false }), cash("0"));
  assert.deepEqual([off.input.shipping, retail(off.input).grandTotal], ["0.00", "46.75"]);
  assert.deepEqual([sale(order(lines), cash("0"), { servicePercent: "12.5" }).input.shipping], ["5.75"]);
});

test("VOID, cancelled, removed and unsent lines are never on the sale", () => {
  const result = sale(
    order([
      line("jollof", 2, "18.00"),
      line("suya", 1, "25.00", { cancelledAt: new Date() }),
      line("pilau", 1, "15.00", { deletedAt: new Date() }),
      line("zobo", 1, "10.00", { kitchenStatus: "NEW" }),
      line("jollof", 1, "18.00", { cancelledAt: new Date() }),
    ]),
    cash("39.60"),
  );
  assert.deepEqual(result.input.items.map((i) => [i.productId, i.quantity]), [["jollof", 2]]);
  assert.equal(retail(result.input).grandTotal, "39.60");
  assert.deepEqual(orderToSale(order([line("jollof", 1, "18", { kitchenStatus: "NEW" })]), { ...OPTIONS, payments: [] }), { ok: false, error: "Nothing to bill yet." });
});

test("a split part: the whole bill becomes the sale, paid only this part's share", () => {
  const lines = [line("jollof", 2, "18.00"), line("zobo", 1, "10.00", { taxRate: "7.5" })];
  const parts = splitEqually("51.35", 3);
  assert.ok(parts.ok);
  // The first part paid, with two methods.
  const first = sale(order(lines), [{ paymentType: "CASH", amount: "10" }, { paymentType: "CARD", amount: "7.11" }], { paymentNote: "1 of 3" });
  const { data, grandTotal } = retail(first.input);
  assert.deepEqual([grandTotal, data.paidAmount, data.paymentType], ["51.35", "10.00", "CASH"]);
  assert.deepEqual(first.morePayments, [{ amount: "7.11", paymentType: "CARD", date: "2026-11-01", notes: "Restaurant ORD-0073 · 1 of 3" }]);
  assert.ok(first.morePayments.every((p) => salePaymentSchema.safeParse(p).success));
  // The sale is part-paid, by exactly the part.
  const paid = [{ amount: "10.00", paymentType: "CASH" as const, date: new Date() }, { amount: "7.11", paymentType: "CARD" as const, date: new Date() }];
  assert.deepEqual([computePaymentState(grandTotal, paid).paymentStatus, computePaymentState(grandTotal, paid).due.toFixed(2)], ["PARTIAL", "34.24"]);
  // Later parts: payments on the sale.
  const later = toSalePayments([{ paymentType: "BANK_TRANSFER", amount: "17.11" }, { paymentType: "CASH", amount: "0" }], "2026-11-01", "Restaurant ORD-0073 · 2 of 3");
  assert.deepEqual(later, [{ amount: "17.11", paymentType: "BANK_TRANSFER", date: "2026-11-01", notes: "Restaurant ORD-0073 · 2 of 3" }]);
  // A payment can't be more than the bill.
  assert.deepEqual(orderToSale(order(lines), { ...OPTIONS, payments: cash("51.36") }), { ok: false, error: "The payment is more than the bill." });
});

test("metadata: order reference, table, type and waiter on the sale's notes; the order's customer when it has one", () => {
  assert.equal(saleNotes({ ref: "ORD-0074", table: null, type: "TAKEAWAY", waiter: null }), "Restaurant ORD-0074 · Takeaway · Waiter: —");
  assert.equal(sale(order([line("jollof", 1, "18")], { customerId: "c9" }), cash("0")).input.customerId, "c9");
});

test("a dish whose tax changed while the order was open: still the bill total exactly", () => {
  // Its lines copied different taxes; the sale line takes the newest, and the difference is the rounding.
  const lines = [line("jollof", 2, "18.00", { taxRate: "0" }), line("jollof", 1, "18.00", { taxRate: "7.5" })];
  const result = sale(order(lines), cash("0"));
  assert.deepEqual([result.input.items.length, result.input.items[0].taxRate], [1, "7.5"]);
  assert.equal(retail(result.input).grandTotal, orderTotals(lines, "10").total.toFixed(2));
});

test("tax-inclusive lines too", () => {
  const lines = [line("jollof", 3, "10.75", { taxType: "INCLUSIVE", taxRate: "7.5" }), line("jollof", 1, "10.75", { taxType: "INCLUSIVE", taxRate: "7.5" })];
  const result = sale(order(lines), cash("0"));
  assert.equal(retail(result.input).grandTotal, orderTotals(lines, "10").total.toFixed(2));
});

test("any order: valid for createSale, and retail's grand total is the bill total to the kobo", () => {
  // A small deterministic generator.
  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    // The high bits: an LCG's low bits repeat in short cycles.
    return Math.floor(seed / 65536) % n;
  };
  const statuses: KitchenStatus[] = ["NEW", "PENDING", "PREPARING", "READY", "SERVED"];
  let checked = 0;
  // Each dish has one tax (a line copies its dish's tax when it's added);
  // its lines differ in price (options), quantity and state.
  const dishTax = [
    { taxType: "EXCLUSIVE", taxRate: "0" },
    { taxType: "EXCLUSIVE", taxRate: "7.5" },
    { taxType: "INCLUSIVE", taxRate: "7.5" },
    { taxType: "EXCLUSIVE", taxRate: "12.5" },
  ] as const;
  for (let round = 0; round < 400; round++) {
    const lines = Array.from({ length: 1 + rand(7) }, () => {
      const dish = rand(4);
      return line(`p${dish}`, 1 + rand(4), `${rand(5000)}.${String(rand(100)).padStart(2, "0")}`, {
        ...dishTax[dish],
        kitchenStatus: statuses[rand(5)],
        cancelledAt: rand(8) === 0 ? new Date() : null,
      });
    });
    const o = order(lines, {
      discountType: [null, "PERCENT", "AMOUNT"][rand(3)] as OrderForSale["discountType"],
      discountValue: String(rand(60)),
      serviceCharge: rand(4) !== 0,
    });
    const result = orderToSale(o, { ...OPTIONS, payments: [] });
    const billed = lines.filter((l) => l.kitchenStatus !== "NEW" && !l.cancelledAt);
    if (billed.length === 0) {
      assert.equal(result.ok, false);
      continue;
    }
    assert.ok(result.ok, `round ${round}: ${result.ok ? "" : result.error}`);
    const total = orderTotals(billed, "10", o).total.toFixed(2);
    assert.equal(retail(result.input).grandTotal, total, `round ${round}`);
    assert.ok(result.rounding.abs().lessThan(1), `round ${round}: rounding stays in kobo`);
    checked++;
  }
  assert.ok(checked > 250, `${checked} orders checked`);
});
