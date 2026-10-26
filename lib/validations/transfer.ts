import { z } from "zod";
import { TransferStatus } from "@prisma/client";
import { TRANSFER_UNITS } from "@/lib/purchase-units";
import { documentShape, itemsArray, lineDiscountRefinement, lineItemShape, unitPrice } from "./purchase";

// A transfer line: the shared line fields, valued at cost, in a transfer unit.
// (The form sends the unit as `purchaseUnit`, like every document line.)
export const transferItemSchema = z
  .object({
    ...lineItemShape,
    purchaseUnit: z.enum(TRANSFER_UNITS, { message: "Choose a unit." }),
    unitCost: unitPrice("cost"),
  })
  .superRefine(lineDiscountRefinement("cost"));

export const transferSchema = z
  .object({
    date: documentShape.date,
    orderTax: documentShape.orderTax,
    discount: documentShape.discount,
    shipping: documentShape.shipping,
    notes: documentShape.notes,
    fromWarehouseId: z.string().trim().min(1, "From warehouse is required."),
    toWarehouseId: z.string().trim().min(1, "To warehouse is required."),
    status: z.nativeEnum(TransferStatus, { message: "Status is required." }),
    // At least one line, qty ≥ 1, each product once.
    items: itemsArray(transferItemSchema),
  })
  // From ≠ To — reported on the To field.
  .refine((data) => !data.fromWarehouseId || data.fromWarehouseId !== data.toWarehouseId, {
    path: ["toWarehouseId"],
    message: "To must be a different warehouse from From.",
  });

export type TransferInput = z.infer<typeof transferSchema>;
