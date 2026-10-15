import { z } from "zod";
import { TaxType } from "@prisma/client";

const emptyToUndefined = (val: unknown) => (val === "" || val === null || val === undefined ? undefined : val);

export const productSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  code: z.string().trim().min(1, "Code is required.").max(50),
  categoryId: z.string().trim().min(1, "Category is required."),
  brandId: z.string().trim().min(1, "Brand is required."),
  unitId: z.string().trim().min(1, "Unit is required."),
  price: z.coerce.number({ message: "Enter a valid price." }).positive("Price must be greater than 0."),
  // Default net unit cost for purchase lines. Kept as a decimal string (no
  // float round-trip) and passed to Prisma's Decimal column as-is.
  cost: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, "Enter a valid cost (up to 2 decimal places).")
      .optional(),
  ),
  stockAlert: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),
  orderTax: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
  taxType: z.nativeEnum(TaxType, { message: "Tax type is required." }),
  quantityLimitation: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),
  notes: z.preprocess(emptyToUndefined, z.string().trim().max(2000).optional()),
});

export type ProductInput = z.infer<typeof productSchema>;

export const STOCK_STATUS_OPTIONS = ["Received", "Pending", "Ordered"] as const;

export const initialStockSchema = z.object({
  warehouseId: z.string().trim().min(1, "Warehouse is required."),
  supplierId: z.string().trim().min(1, "Supplier is required."),
  quantity: z.coerce.number().int("Quantity must be a whole number.").positive("Quantity must be greater than 0."),
  status: z.enum(STOCK_STATUS_OPTIONS, { message: "Status is required." }),
});

export type InitialStockInput = z.infer<typeof initialStockSchema>;
