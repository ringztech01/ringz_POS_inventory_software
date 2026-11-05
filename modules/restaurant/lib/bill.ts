import type { KitchenStatus, OrderDiscountType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/index-browser";
import { formatNaira } from "@/lib/format";
import { countsTowardsTotal, discountAmount, orderTotals, type OrderAdjustments, type PricedLine } from "./orderTotals";

// The bill's rules (Bill panel, pre-bill, and later the settle):
//
//   billed      lines sent to the kitchen — Sent, Preparing, Ready, Served
//   left out    cancelled (VOID) and removed lines, and remakes (made at no
//               charge — the line they remake is billed): never billed
//   unsent      New lines: not billed, and the order can't be settled until
//               they're sent or removed
//   not served  billed lines not Served yet: a warning only
//
// Totals come from the billed lines' snapshots through orderTotals
// (lib/pricing.ts — retail's tax rules), never from the browser. The
// discount and service charge are the order's own (OrderAdjustments).

// remakeOfId: set on a remake line (required, so every bill query selects it).
export type BillLineInput = PricedLine & { kitchenStatus: KitchenStatus; remakeOfId: string | null };

type BillRule = Pick<BillLineInput, "kitchenStatus" | "cancelledAt" | "deletedAt" | "remakeOfId">;

export const isBilled = (line: BillRule) => countsTowardsTotal(line) && line.kitchenStatus !== "NEW" && !line.remakeOfId;
export const isUnsent = (line: Pick<BillLineInput, "kitchenStatus" | "cancelledAt" | "deletedAt">) =>
  countsTowardsTotal(line) && line.kitchenStatus === "NEW";

export type BillSummary = {
  billed: number;
  unsent: number;
  notServed: number;
  subTotal: Decimal;
  discount: Decimal;
  serviceCharge: Decimal;
  tax: Decimal;
  total: Decimal;
  taxRates: string[];
  // Why it can't be settled yet, if it can't.
  settleBlocker: string | null;
};

export function summariseBill(lines: readonly BillLineInput[], servicePercent: Decimal.Value, adjustments: OrderAdjustments = {}): BillSummary {
  const billed = lines.filter(isBilled);
  const unsent = lines.filter(isUnsent).length;
  const totals = orderTotals(billed, servicePercent, adjustments);
  return {
    billed: billed.length,
    unsent,
    notServed: billed.filter((line) => line.kitchenStatus !== "SERVED").length,
    ...totals,
    settleBlocker:
      unsent > 0
        ? `${unsent} ${unsent === 1 ? "line hasn't" : "lines haven't"} been sent to the kitchen. Send or remove ${unsent === 1 ? "it" : "them"} first.`
        : billed.length === 0
          ? "Nothing to bill yet."
          : null,
  };
}

export const NOT_A_RECEIPT = "NOT A RECEIPT";

// A discount asked for on the bill: whether it can be given, and whether it
// needs an approver (more than the limit — BusinessSetting.restaurant-
// DiscountLimitPercent — of the bill's sub total). An amount is measured
// against the sub total as it is now.
export type DiscountCheck = { ok: true; amount: Decimal; percent: Decimal; needsApproval: boolean } | { ok: false; error: string };

export function checkDiscount(subTotal: Decimal.Value, type: OrderDiscountType, value: Decimal.Value, limitPercent: Decimal.Value): DiscountCheck {
  const base = new Decimal(subTotal);
  const asked = new Decimal(value);
  if (type === "AMOUNT") {
    if (base.isZero()) return { ok: false, error: "Nothing is billed yet. Send lines to the kitchen before taking an amount off." };
    if (asked.greaterThan(base)) return { ok: false, error: `The discount can't be more than the sub total (${formatNaira(base.toFixed(2))}).` };
  }
  const percent = type === "PERCENT" ? asked : asked.times(100).div(base);
  return { ok: true, amount: discountAmount(base, type, asked), percent, needsApproval: percent.greaterThan(limitPercent) };
}

// "10% off" / "₦2,000.00 off", for the bill.
export function discountLabel(type: OrderDiscountType, value: Decimal.Value): string {
  return type === "PERCENT" ? `${new Decimal(value).toString()}%` : formatNaira(new Decimal(value).toFixed(2));
}
