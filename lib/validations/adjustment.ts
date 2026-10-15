import { z } from "zod";
import { AdjustmentItemType } from "@prisma/client";

export const adjustmentItemSchema = z.object({
  productId: z.string().trim().min(1),
  quantity: z.coerce.number().int("Quantity must be a whole number.").positive("Quantity must be at least 1."),
  type: z.nativeEnum(AdjustmentItemType),
});

export const adjustmentSchema = z.object({
  warehouseId: z.string().trim().min(1, "Warehouse is required."),
  date: z.coerce.date({ message: "Enter a valid date." }),
  items: z
    .array(adjustmentItemSchema)
    .min(1, "Add at least one item.")
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, {
      message: "Each product can only appear once.",
    }),
});

export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
