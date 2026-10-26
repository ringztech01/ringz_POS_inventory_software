import { z } from "zod";

export const EXPENSE_CATEGORY_NAME_MAX = 150;

export const expenseCategorySchema = z.object({
  name: z
    .string({ message: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(EXPENSE_CATEGORY_NAME_MAX, `Name can be at most ${EXPENSE_CATEGORY_NAME_MAX} characters.`),
});

export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;
