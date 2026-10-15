// Run with: npx tsx --test lib/pricing.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { computeLine, computeOrder, sumSubtotals, type LineInput } from "./pricing";

// Compare money as fixed 2dp strings so the assertion is about the exact
// stored value, never a float approximation.
function money(d: Decimal): string {
  return d.toFixed(2);
}

function line(input: Partial<LineInput>) {
  const r = computeLine({
    unitCost: 0,
    quantity: 1,
    discountType: "FIXED",
    discount: 0,
    taxType: "EXCLUSIVE",
    taxRate: 0,
    ...input,
  });
  return {
    unitCost: money(r.unitCost),
    discountPerUnit: money(r.discountPerUnit),
    discountAmount: money(r.discountAmount),
    netUnitCost: money(r.netUnitCost),
    taxPerUnit: money(r.taxPerUnit),
    taxAmount: money(r.taxAmount),
    subtotal: money(r.subtotal),
  };
}

describe("computeLine — tax type", () => {
  test("exclusive adds tax on top of the unit cost", () => {
    assert.deepEqual(line({ unitCost: "1000", quantity: 3, taxType: "EXCLUSIVE", taxRate: "7.5" }), {
      unitCost: "1000.00",
      discountPerUnit: "0.00",
      discountAmount: "0.00",
      netUnitCost: "1000.00",
      taxPerUnit: "75.00",
      taxAmount: "225.00",
      subtotal: "3225.00",
    });
  });

  test("inclusive extracts tax from the unit cost; subtotal is unchanged", () => {
    assert.deepEqual(line({ unitCost: "1075", quantity: 2, taxType: "INCLUSIVE", taxRate: "7.5" }), {
      unitCost: "1075.00",
      discountPerUnit: "0.00",
      discountAmount: "0.00",
      netUnitCost: "1000.00",
      taxPerUnit: "75.00",
      taxAmount: "150.00",
      subtotal: "2150.00",
    });
  });

  test("inclusive with a non-terminating extraction rounds at 2dp", () => {
    // 100 / 1.075 = 93.0232…; line tax = 3 × 6.9767… = 20.930… → 20.93
    assert.deepEqual(line({ unitCost: "100", quantity: 3, taxType: "INCLUSIVE", taxRate: "7.5" }), {
      unitCost: "100.00",
      discountPerUnit: "0.00",
      discountAmount: "0.00",
      netUnitCost: "93.02",
      taxPerUnit: "6.98",
      taxAmount: "20.93",
      subtotal: "300.00",
    });
  });

  test("same price with 0% tax gives the same result for inclusive and exclusive", () => {
    const incl = line({ unitCost: "250", quantity: 2, taxType: "INCLUSIVE", taxRate: 0 });
    const excl = line({ unitCost: "250", quantity: 2, taxType: "EXCLUSIVE", taxRate: 0 });
    assert.deepEqual(incl, excl);
    assert.equal(incl.subtotal, "500.00");
    assert.equal(incl.taxAmount, "0.00");
  });
});

describe("computeLine — discount type", () => {
  test("fixed discount is per unit and applied before exclusive tax", () => {
    assert.deepEqual(
      line({ unitCost: "500", quantity: 4, discountType: "FIXED", discount: "50", taxType: "EXCLUSIVE", taxRate: "10" }),
      {
        unitCost: "500.00",
        discountPerUnit: "50.00",
        discountAmount: "200.00",
        netUnitCost: "450.00",
        taxPerUnit: "45.00",
        taxAmount: "180.00",
        subtotal: "1980.00",
      },
    );
  });

  test("percentage discount is a % of the unit cost", () => {
    assert.deepEqual(line({ unitCost: "500", quantity: 2, discountType: "PERCENTAGE", discount: "10" }), {
      unitCost: "500.00",
      discountPerUnit: "50.00",
      discountAmount: "100.00",
      netUnitCost: "450.00",
      taxPerUnit: "0.00",
      taxAmount: "0.00",
      subtotal: "900.00",
    });
  });

  test("percentage discount combined with inclusive tax", () => {
    // 1000 − 12.5% = 875; 875 / 1.075 = 813.953…
    assert.deepEqual(
      line({ unitCost: "1000", quantity: 1, discountType: "PERCENTAGE", discount: "12.5", taxType: "INCLUSIVE", taxRate: "7.5" }),
      {
        unitCost: "1000.00",
        discountPerUnit: "125.00",
        discountAmount: "125.00",
        netUnitCost: "813.95",
        taxPerUnit: "61.05",
        taxAmount: "61.05",
        subtotal: "875.00",
      },
    );
  });

  test("percentage discount that doesn't land on 2dp rounds the discounted price", () => {
    // 33.33 × 33% = 10.9989 → discounted price 22.33, so discount/unit = 11.00
    const r = line({ unitCost: "33.33", quantity: 3, discountType: "PERCENTAGE", discount: "33" });
    assert.equal(r.discountPerUnit, "11.00");
    assert.equal(r.discountAmount, "33.00");
    assert.equal(r.netUnitCost, "22.33");
    assert.equal(r.subtotal, "66.99");
  });

  test("a fixed discount larger than the cost is capped at the cost", () => {
    const r = line({ unitCost: "500", quantity: 2, discountType: "FIXED", discount: "600", taxRate: "10" });
    assert.equal(r.discountPerUnit, "500.00");
    assert.equal(r.discountAmount, "1000.00");
    assert.equal(r.subtotal, "0.00");
  });

  test("a percentage discount over 100% is capped at the cost", () => {
    const r = line({ unitCost: "500", quantity: 1, discountType: "PERCENTAGE", discount: "150" });
    assert.equal(r.discountPerUnit, "500.00");
    assert.equal(r.subtotal, "0.00");
  });
});

describe("computeLine — zero, empty and precision cases", () => {
  test("all-zero line is all zeros", () => {
    assert.deepEqual(line({}), {
      unitCost: "0.00",
      discountPerUnit: "0.00",
      discountAmount: "0.00",
      netUnitCost: "0.00",
      taxPerUnit: "0.00",
      taxAmount: "0.00",
      subtotal: "0.00",
    });
  });

  test("zero quantity gives zero line totals but keeps per-unit values", () => {
    const r = line({ unitCost: "100", quantity: 0, taxRate: "10" });
    assert.equal(r.netUnitCost, "100.00");
    assert.equal(r.taxPerUnit, "10.00");
    assert.equal(r.taxAmount, "0.00");
    assert.equal(r.subtotal, "0.00");
  });

  test("empty-string and null inputs (half-typed form fields) are treated as 0", () => {
    const r = line({ unitCost: "1000", quantity: 2, discount: "", taxRate: null });
    assert.equal(r.subtotal, "2000.00");
    assert.equal(r.taxAmount, "0.00");
  });

  test("unparseable and negative inputs are treated as 0", () => {
    const r = line({ unitCost: "1000", quantity: 1, discount: "abc", taxRate: "-5" });
    assert.equal(r.subtotal, "1000.00");
    assert.equal(r.discountAmount, "0.00");
  });

  test("no float drift: 0.1 × 3 is exactly 0.30", () => {
    assert.equal(line({ unitCost: "0.1", quantity: 3 }).subtotal, "0.30");
  });

  test("rounding is half-up, not banker's", () => {
    // 0.10 × 5% = 0.005 → 0.01
    const r = line({ unitCost: "0.10", quantity: 1, taxRate: "5" });
    assert.equal(r.taxAmount, "0.01");
    assert.equal(r.subtotal, "0.11");
  });

  test("accepts Decimal inputs (e.g. Prisma Decimal values read from the DB)", () => {
    const r = line({ unitCost: new Decimal("1000"), quantity: 1, taxRate: new Decimal("7.5") });
    assert.equal(r.subtotal, "1075.00");
  });

  test("subtotal always equals line net + line tax for exclusive, and line price for inclusive", () => {
    for (const taxType of ["INCLUSIVE", "EXCLUSIVE"] as const) {
      for (const [cost, qty, rate] of [["100", 3, "7.5"], ["19.99", 7, "12.5"], ["0.33", 11, "5"]] as const) {
        const r = computeLine({ unitCost: cost, quantity: qty, discountType: "FIXED", discount: 0, taxType, taxRate: rate });
        const linePrice = new Decimal(cost).times(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const expected = taxType === "EXCLUSIVE" ? linePrice.plus(r.taxAmount) : linePrice;
        assert.equal(money(r.subtotal), money(expected), `${taxType} ${cost}×${qty}@${rate}%`);
      }
    }
  });
});

describe("sumSubtotals", () => {
  test("sums Decimal-exact", () => {
    assert.equal(money(sumSubtotals(["0.10", "0.20"])), "0.30");
  });

  test("empty list is 0", () => {
    assert.equal(money(sumSubtotals([])), "0.00");
  });
});

describe("computeOrder", () => {
  function order(input: Parameters<typeof computeOrder>[0]) {
    const r = computeOrder(input);
    return {
      itemsTotal: money(r.itemsTotal),
      taxRate: money(r.taxRate),
      orderTaxAmount: money(r.orderTaxAmount),
      discount: money(r.discount),
      shipping: money(r.shipping),
      grandTotal: money(r.grandTotal),
    };
  }

  test("zero order tax, discount and shipping: grand total is the items total", () => {
    assert.deepEqual(order({ itemsTotal: "4930", taxRate: 0, discount: 0, shipping: 0 }), {
      itemsTotal: "4930.00",
      taxRate: "0.00",
      orderTaxAmount: "0.00",
      discount: "0.00",
      shipping: "0.00",
      grandTotal: "4930.00",
    });
  });

  test("order tax only", () => {
    const r = order({ itemsTotal: "1000", taxRate: "7.5", discount: 0, shipping: 0 });
    assert.equal(r.orderTaxAmount, "75.00");
    assert.equal(r.grandTotal, "1075.00");
  });

  test("discount comes off before order tax; shipping is added after (untaxed)", () => {
    // taxable = 10000 − 1000 = 9000; tax 10% = 900; + 500 shipping
    assert.deepEqual(order({ itemsTotal: "10000", taxRate: "10", discount: "1000", shipping: "500" }), {
      itemsTotal: "10000.00",
      taxRate: "10.00",
      orderTaxAmount: "900.00",
      discount: "1000.00",
      shipping: "500.00",
      grandTotal: "10400.00",
    });
  });

  test("order tax rounds half-up at 2dp", () => {
    // 99.99 × 7.5% = 7.49925 → 7.50
    const r = order({ itemsTotal: "99.99", taxRate: "7.5", discount: 0, shipping: 0 });
    assert.equal(r.orderTaxAmount, "7.50");
    assert.equal(r.grandTotal, "107.49");
  });

  test("a discount larger than the items total is capped at the items total", () => {
    const r = order({ itemsTotal: "100", taxRate: "10", discount: "150", shipping: "20" });
    assert.equal(r.discount, "100.00");
    assert.equal(r.orderTaxAmount, "0.00");
    assert.equal(r.grandTotal, "20.00");
  });

  test("empty, unparseable and negative inputs are treated as 0", () => {
    assert.deepEqual(order({ itemsTotal: "", taxRate: "x", discount: null, shipping: "-50" }), {
      itemsTotal: "0.00",
      taxRate: "0.00",
      orderTaxAmount: "0.00",
      discount: "0.00",
      shipping: "0.00",
      grandTotal: "0.00",
    });
  });

  test("composes with computeLine + sumSubtotals", () => {
    const a = computeLine({ unitCost: "1000", quantity: 2, discountType: "FIXED", discount: "100", taxType: "EXCLUSIVE", taxRate: "10" });
    const b = computeLine({ unitCost: "1075", quantity: 1, discountType: "PERCENTAGE", discount: 0, taxType: "INCLUSIVE", taxRate: "7.5" });
    // a: (900 × 2) + 180 = 1980; b: 1075 → items 3055
    const r = order({ itemsTotal: sumSubtotals([a.subtotal, b.subtotal]), taxRate: "5", discount: "55", shipping: "1000" });
    assert.equal(r.itemsTotal, "3055.00");
    assert.equal(r.orderTaxAmount, "150.00");
    assert.equal(r.grandTotal, "4150.00");
  });
});
