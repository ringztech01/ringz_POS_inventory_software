import { z } from "zod";
import { DiscountType, PurchaseStatus, TaxType } from "@prisma/client";
import { toDecimal } from "@/lib/pricing";
import { PURCHASE_UNITS } from "@/lib/purchase-units";

const DECIMAL_2DP = /^\d{1,10}(\.\d{1,2})?$/;

// Money and percentages stay decimal strings end to end (never floats); empty
// optional fields become "0".
export const money = (label: string) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? "0" : value),
    z.string().trim().regex(DECIMAL_2DP, `Enter a valid ${label} (up to 2 decimal places).`),
  );

const percent = (label: string) =>
  money(label).refine((value) => toDecimal(value).lessThanOrEqualTo(100), `${label} can't be more than 100%.`);

// --- Shared building blocks for purchase documents (Purchases, Purchase
// Returns) and Sales. Zod 4 can't .omit/.extend an object that already has
// refinements, so the shapes are composed from these instead.

// Line fields other than the unit price (cost for purchases, price for sales).
export const lineItemShape = {
  productId: z.string().trim().min(1),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    .max(1_000_000, "Quantity is too large."),
  discountType: z.nativeEnum(DiscountType, { message: "Choose a discount type." }),
  discount: money("discount"),
  taxType: z.nativeEnum(TaxType, { message: "Choose a tax type." }),
  taxRate: percent("Order tax"),
  // Purchase unit / sale unit — same choices.
  purchaseUnit: z.enum(PURCHASE_UNITS, { message: "Choose a unit." }),
};

export const unitPrice = (label: string) =>
  z.string().trim().regex(DECIMAL_2DP, `Enter a valid product ${label} (up to 2 decimal places).`);

// Percentage ≤ 100; a fixed discount can't exceed the unit price (skipped
// while the price is unknown — the server re-checks after filling it).
export function lineDiscountRefinement(label: string) {
  return (item: { discountType: DiscountType; discount: string; unitCost?: string }, ctx: z.RefinementCtx) => {
    const discount = toDecimal(item.discount);
    if (item.discountType === "PERCENTAGE" && discount.greaterThan(100)) {
      ctx.addIssue({ code: "custom", path: ["discount"], message: "A percentage discount can't be more than 100%." });
    } else if (
      item.discountType === "FIXED" &&
      item.unitCost !== undefined &&
      discount.greaterThan(toDecimal(item.unitCost))
    ) {
      ctx.addIssue({ code: "custom", path: ["discount"], message: `Discount can't be more than the product ${label}.` });
    }
  };
}

export function itemsArray<T extends z.ZodType<{ productId: string }>>(item: T) {
  return z
    .array(item)
    .min(1, "Add at least one item.")
    .refine((items) => new Set(items.map((line) => line.productId)).size === items.length, {
      message: "Each product can only appear once.",
    });
}

// "YYYY-MM-DD" that is a real calendar day (rejects e.g. 2026-02-31, which
// Date would silently roll over into March).
function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Stored anchored at UTC midnight, like every other date-only value here
// (see formatDateForInput in lib/format.ts and the list's date filter).
export const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
  .refine(isCalendarDate, "Enter a valid date.")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

// Header fields other than the party (supplier / customer).
export const documentShape = {
  date: dateOnly,
  warehouseId: z.string().trim().min(1, "Warehouse is required."),
  status: z.nativeEnum(PurchaseStatus, { message: "Status is required." }),
  orderTax: percent("Order tax"),
  discount: money("discount"),
  shipping: money("shipping"),
  notes: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(2000, "Notes can be at most 2000 characters.").optional(),
  ),
};

export const purchaseItemSchema = z
  .object({ ...lineItemShape, unitCost: unitPrice("cost") })
  .superRefine(lineDiscountRefinement("cost"));

export const purchaseSchema = z.object({
  ...documentShape,
  supplierId: z.string().trim().min(1, "Supplier is required."),
  items: itemsArray(purchaseItemSchema),
});

export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type PurchaseItemInput = z.infer<typeof purchaseItemSchema>;
