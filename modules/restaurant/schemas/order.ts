import { z } from "zod";
import { MAX_GUESTS } from "../lib/orderLines";
import { idSchema } from "./common";

// Every order-screen change carries the version its screen showed; the
// server refuses it if the order has moved on since (Order.version).
export const orderVersionSchema = z.number().int().min(0);

// One of the ticket header's selects, saved as soon as it changes.
export const orderDetailsSchema = z.object({
  orderId: idSchema,
  version: orderVersionSchema,
  change: z.discriminatedUnion("field", [
    z.object({ field: z.literal("type"), value: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]) }),
    z.object({ field: z.literal("waiterId"), value: idSchema }),
    z.object({ field: z.literal("guests"), value: z.number().int().min(1).max(MAX_GUESTS) }),
  ]),
});

export type OrderDetailsInput = z.infer<typeof orderDetailsSchema>;
export type OrderDetailsChange = OrderDetailsInput["change"];
