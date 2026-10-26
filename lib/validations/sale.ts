import { z } from "zod";
import { PaymentType } from "@prisma/client";
import { toDecimal } from "@/lib/pricing";
import {
  dateOnly,
  documentShape,
  itemsArray,
  lineDiscountRefinement,
  lineItemShape,
  money,
  unitPrice,
} from "./purchase";

// A sale line: same fields and rules as a purchase line, but the unit price
// may be left blank — the server then uses the product's price from the DB.
// (The form always sends the price it shows, which starts as that DB price.)
export const saleItemSchema = z
  .object({
    ...lineItemShape,
    unitCost: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      unitPrice("price").optional(),
    ),
  })
  .superRefine(lineDiscountRefinement("price"));

export const saleSchema = z.object({
  ...documentShape,
  customerId: z.string().trim().min(1, "Customer is required."),
  items: itemsArray(saleItemSchema),
  // Optional first payment taken with the sale (≥ 0; the server also checks
  // it's not more than the recomputed grand total).
  paidAmount: money("paid amount"),
  paymentType: z.nativeEnum(PaymentType, { message: "Choose a payment type." }).default("CASH"),
});

export type SaleInput = z.infer<typeof saleSchema>;

// "Show Payments" → Add payment. The server also rejects an amount above the
// sale's current due.
export const salePaymentSchema = z.object({
  amount: money("amount").refine((value) => toDecimal(value).greaterThan(0), "Amount must be more than 0."),
  paymentType: z.nativeEnum(PaymentType, { message: "Choose a payment type." }),
  date: dateOnly,
  notes: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(500, "Notes can be at most 500 characters.").optional(),
  ),
});

export type SalePaymentInput = z.infer<typeof salePaymentSchema>;
