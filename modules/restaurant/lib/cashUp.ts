import { Decimal } from "@prisma/client/runtime/index-browser";
import type { PaymentType } from "@prisma/client";
import { formatNaira } from "@/lib/format";

// Cash-up (Part 6f Step 7b). A till opens with a float; at the close the
// cash in the drawer is counted. What should be there: the float, the cash
// taken (bills and counter sales, net of change), cash tips (still in the
// drawer until they're paid out) less cash refunds. The variance is what was
// counted less that: over (+) or short (−). Pure; the service sums the
// figures.

export const FLOAT_MAX = new Decimal("10000000");

export type CashFigures = { float: Decimal.Value; cashSales: Decimal.Value; cashTips: Decimal.Value; cashRefunds: Decimal.Value };

export function expectedCash(f: CashFigures): Decimal {
  return new Decimal(f.float).plus(f.cashSales).plus(f.cashTips).minus(f.cashRefunds).toDecimalPlaces(2);
}

export function variance(counted: Decimal.Value, expected: Decimal.Value): Decimal {
  return new Decimal(counted).minus(expected).toDecimalPlaces(2);
}

// "Balanced", "Over ₦500.00", "Short ₦1,250.00".
export function varianceLabel(v: Decimal.Value): string {
  const d = new Decimal(v);
  if (d.isZero()) return "Balanced";
  return `${d.isPositive() ? "Over" : "Short"} ${formatNaira(d.abs().toFixed(2))}`;
}

// A typed amount ("25000", "25,000.50", "₦1,000"): naira with up to two
// decimals, from 0 to ₦10,000,000 — or null.
export function parseCash(typed: unknown): Decimal | null {
  if (typeof typed !== "string" && typeof typed !== "number") return null;
  const plain = String(typed).replace(/[₦,\s]/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(plain)) return null;
  const d = new Decimal(plain);
  return d.greaterThan(FLOAT_MAX) ? null : d;
}

export const METHOD_LABEL: Record<PaymentType, string> = { CASH: "Cash", CARD: "Card", BANK_TRANSFER: "Transfer", CHEQUE: "Cheque" };
export const METHODS: readonly PaymentType[] = ["CASH", "CARD", "BANK_TRANSFER", "CHEQUE"];
