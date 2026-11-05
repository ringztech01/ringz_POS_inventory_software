import { z } from "zod";
import { MAX_BILL_PARTS } from "../lib/billSplit";
import { MAX_LINE_QUANTITY } from "../lib/modifiers";
import { MAX_PAYMENT_METHODS } from "../lib/tender";
import { idSchema } from "./common";
import { orderVersionSchema } from "./order";

export const DISCOUNT_REASON_MAX = 140;

// An approver's PIN: 4 to 6 digits.
export const pinSchema = z.string({ message: "Enter the PIN." }).trim().regex(/^\d{4,6}$/, "The PIN is 4 to 6 digits.");

// Discount on the bill (applyOrderDiscount). A % (more than 0, up to 100)
// or an amount in Naira; 0 of either removes the discount. Above the limit
// it also carries the approver and their PIN — the server checks both.
export const orderDiscountSchema = z
  .object({
    orderId: idSchema,
    version: orderVersionSchema,
    type: z.enum(["PERCENT", "AMOUNT"]),
    value: z
      .string({ message: "Enter the discount." })
      .trim()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter a number like 10 or 2500.50."),
    reason: z.string().trim().max(DISCOUNT_REASON_MAX, `The reason can be at most ${DISCOUNT_REASON_MAX} characters.`).default(""),
    approval: z.object({ approverId: idSchema, pin: pinSchema }).optional(),
  })
  .refine((d) => d.type !== "PERCENT" || Number(d.value) <= 100, { message: "A percentage can't be more than 100.", path: ["value"] })
  .refine((d) => Number(d.value) === 0 || d.reason.length > 0, { message: "Give a reason for the discount.", path: ["reason"] });

export type OrderDiscountInput = z.infer<typeof orderDiscountSchema>;

// The bill's Service charge switch.
export const serviceChargeSchema = z.object({ orderId: idSchema, version: orderVersionSchema, on: z.boolean() });

// My approval PIN: typed twice.
export const approvalPinSchema = z
  .object({ pin: pinSchema, confirm: z.string().trim() })
  .refine((d) => d.pin === d.confirm, { message: "The two PINs don't match.", path: ["confirm"] });

// Split bill. EQUAL: how many ways. AMOUNT: the first parts' amounts (the
// last part pays the rest). ITEMS: per guest, how many of each line's units
// they pay for. Only ids and counts come from the browser; the server works
// out every part's amount.
const moneySchema = z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter amounts like 5000 or 2500.50.");
export const splitBillSchema = z.object({
  orderId: idSchema,
  version: orderVersionSchema,
  split: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("EQUAL"), ways: z.number().int().min(2).max(MAX_BILL_PARTS) }),
    z.object({ mode: z.literal("AMOUNT"), amounts: z.array(moneySchema).min(1).max(MAX_BILL_PARTS - 1) }),
    z.object({
      mode: z.literal("ITEMS"),
      parts: z
        .array(z.array(z.object({ lineId: idSchema, quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY) })).max(200))
        .min(2)
        .max(MAX_BILL_PARTS),
    }),
  ]),
});

export type SplitBillInput = z.infer<typeof splitBillSchema>;
export type BillSplit = SplitBillInput["split"];

// Pay as one bill: the split's parts go.
export const clearSplitSchema = z.object({ orderId: idSchema, version: orderVersionSchema });

// Settle: pay the whole bill, or one part of a split bill (partId). The
// methods and amounts handed over, and an optional tip — never what's due:
// the server works that out. idempotencyKey: made when the Payment pop-up
// opens, so a retry of the same payment can't settle twice (Step 6).
export const settleSchema = z.object({
  orderId: idSchema,
  version: orderVersionSchema,
  partId: idSchema.optional(),
  payments: z
    .array(z.object({ paymentType: z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE"]), amount: moneySchema }))
    .max(MAX_PAYMENT_METHODS),
  tip: moneySchema.default("0"),
  idempotencyKey: z.uuid(),
});

export type SettleInput = z.infer<typeof settleSchema>;

export const REFUND_REASON_MAX = 140;

// Refund (a settled bill): the sale lines and how many of each, whether the
// dishes go back into stock (their ingredients as settled), how the money
// goes back and why. The amounts are the server's. idempotencyKey: made
// when the Refund pop-up opens, so a retry can't refund twice.
export const refundSchema = z.object({
  orderId: idSchema,
  lines: z
    .array(z.object({ saleItemId: idSchema, quantity: z.number().int().min(1).max(1_000_000) }))
    .min(1, "Choose what to refund.")
    .max(200),
  returnToStock: z.boolean(),
  paymentType: z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE"]),
  reason: z.string().trim().min(1, "Give a reason for the refund.").max(REFUND_REASON_MAX, `The reason can be at most ${REFUND_REASON_MAX} characters.`),
  idempotencyKey: z.uuid(),
});

export type RefundInput = z.infer<typeof refundSchema>;
