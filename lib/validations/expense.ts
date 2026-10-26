import { z } from "zod";
import { Prisma } from "@prisma/client";
import { dateOnly } from "./purchase";

// Up to 10 digits, optional 2 decimals — fits Decimal(12, 2).
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

export const expenseSchema = z.object({
  // "YYYY-MM-DD", a real calendar day → Date at UTC midnight.
  date: dateOnly,
  title: z
    .string({ message: "Expense title is required." })
    .trim()
    .min(1, "Expense title is required.")
    .max(191, "Expense title can be at most 191 characters."),
  // Existence (and not soft-deleted) is checked server-side after parsing.
  warehouseId: z.string({ message: "Warehouse is required." }).trim().min(1, "Warehouse is required."),
  expenseCategoryId: z
    .string({ message: "Expense category is required." })
    .trim()
    .min(1, "Expense category is required."),
  // Validated as a string and compared as a Prisma.Decimal — never a float.
  // `abort` stops at the first failing check, so the Decimal is only ever
  // built from a string that matched the pattern (it throws on e.g. "abc").
  amount: z
    .string({ message: "Amount is required." })
    .trim()
    .min(1, { message: "Amount is required.", abort: true })
    .regex(AMOUNT, { message: "Enter a valid amount (up to 2 decimal places).", abort: true })
    .refine((value) => new Prisma.Decimal(value).greaterThan(0), "Amount must be more than 0."),
  details: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(2000, "Details can be at most 2000 characters.").optional(),
  ),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
