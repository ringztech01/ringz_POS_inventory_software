import { z } from "zod";
import { DiscountType, PurchaseStatus, TaxType } from "@prisma/client";
import { toDecimal } from "@/lib/pricing";
import { PURCHASE_UNITS } from "@/lib/purchase-units";

const DECIMAL_2DP = /^\d{1,10}(\.\d{1,2})?$/;

// Money and percentages stay decimal strings end to end (never floats); empty
// optional fields become "0".
const money = (label: string) =>
  z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? "0" : value),
    z.string().trim().regex(DECIMAL_2DP, `Enter a valid ${label} (up to 2 decimal places).`),
  );

const percent = (label: string) =>
  money(label).refine((value) => toDecimal(value).lessThanOrEqualTo(100), `${label} can't be more than 100%.`);

export const purchaseItemSchema = z
  .object({
    productId: z.string().trim().min(1),
    quantity: z.coerce
      .number()
      .int("Quantity must be a whole number.")
      .min(1, "Quantity must be at least 1.")
      .max(1_000_000, "Quantity is too large."),
    unitCost: z.string().trim().regex(DECIMAL_2DP, "Enter a valid product cost (up to 2 decimal places)."),
    discountType: z.nativeEnum(DiscountType, { message: "Choose a discount type." }),
    discount: money("discount"),
    taxType: z.nativeEnum(TaxType, { message: "Choose a tax type." }),
    taxRate: percent("Order tax"),
    purchaseUnit: z.enum(PURCHASE_UNITS, { message: "Choose a purchase unit." }),
  })
  .superRefine((item, ctx) => {
    const discount = toDecimal(item.discount);
    if (item.discountType === "PERCENTAGE" && discount.greaterThan(100)) {
      ctx.addIssue({ code: "custom", path: ["discount"], message: "A percentage discount can't be more than 100%." });
    } else if (item.discountType === "FIXED" && discount.greaterThan(toDecimal(item.unitCost))) {
      ctx.addIssue({ code: "custom", path: ["discount"], message: "Discount can't be more than the product cost." });
    }
  });

// "YYYY-MM-DD" that is a real calendar day (rejects e.g. 2026-02-31, which
// Date would silently roll over into March).
function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const purchaseSchema = z.object({
  // Stored anchored at UTC midnight, like every other date-only value here
  // (see formatDateForInput in lib/format.ts and the list's date filter).
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .refine(isCalendarDate, "Enter a valid date.")
    .transform((value) => new Date(`${value}T00:00:00.000Z`)),
  warehouseId: z.string().trim().min(1, "Warehouse is required."),
  supplierId: z.string().trim().min(1, "Supplier is required."),
  status: z.nativeEnum(PurchaseStatus, { message: "Status is required." }),
  orderTax: percent("Order tax"),
  discount: money("discount"),
  shipping: money("shipping"),
  notes: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(2000, "Notes can be at most 2000 characters.").optional(),
  ),
  items: z
    .array(purchaseItemSchema)
    .min(1, "Add at least one item.")
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, {
      message: "Each product can only appear once.",
    }),
});

export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type PurchaseItemInput = z.infer<typeof purchaseItemSchema>;
