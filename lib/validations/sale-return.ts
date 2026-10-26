import { z } from "zod";
import { SaleReturnStatus } from "@prisma/client";
import { documentShape, lineDiscountRefinement, lineItemShape, unitPrice } from "./purchase";

// A returned line: one of the original sale's lines (saleItemId), with the
// same price/discount/tax fields as any document line. The product is taken
// from the sale line server-side; the client's productId is ignored.
export const saleReturnItemSchema = z
  .object({
    ...lineItemShape,
    saleItemId: z.string().trim().min(1),
    unitCost: unitPrice("price"),
  })
  .superRefine(lineDiscountRefinement("price"));

export const saleReturnSchema = z.object({
  date: documentShape.date,
  orderTax: documentShape.orderTax,
  discount: documentShape.discount,
  shipping: documentShape.shipping,
  notes: documentShape.notes,
  // Customer and warehouse come from this sale, never from the client.
  saleId: z.string().trim().min(1, "Sale is required."),
  status: z.nativeEnum(SaleReturnStatus, { message: "Status is required." }),
  items: z
    .array(saleReturnItemSchema)
    .min(1, "Add at least one item.")
    .refine((items) => new Set(items.map((item) => item.saleItemId)).size === items.length, {
      message: "Each sale line can only appear once.",
    }),
});

export type SaleReturnInput = z.infer<typeof saleReturnSchema>;
