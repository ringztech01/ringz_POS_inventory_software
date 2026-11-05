import { z } from "zod";
import { CANCEL_DETAILS_MAX, CANCEL_REASONS, type CancelReason } from "../lib/cancelReasons";
import { pinSchema } from "./bill";
import { idSchema } from "./common";
import { orderVersionSchema } from "./order";

// Send to kitchen, Mark served and the cancellations. Each carries the
// version its screen showed.

export const sendToKitchenSchema = z.object({ orderId: idSchema, version: orderVersionSchema });

export const lineActionSchema = z.object({ orderId: idSchema, version: orderVersionSchema, lineId: idSchema });

// Mark served from the Ready bar: the Ready lines it showed.
export const serveLinesSchema = z.object({ orderId: idSchema, version: orderVersionSchema, lineIds: z.array(idSchema).min(1).max(100) });

// A reason from the list, plus free text (required for Other).
const reason = {
  reason: z.enum(Object.keys(CANCEL_REASONS) as [CancelReason, ...CancelReason[]], { message: "Pick a reason." }),
  details: z
    .string()
    .trim()
    .max(CANCEL_DETAILS_MAX, `Keep it to ${CANCEL_DETAILS_MAX} characters.`)
    .transform((value) => value || null),
};
const otherNeedsDetails = <T extends { reason: CancelReason; details: string | null }>(value: T) =>
  value.reason !== "OTHER" || !!value.details;
const OTHER_MESSAGE = { message: "Say what happened.", path: ["details"] };

// A line: Returned by guest can say the food was wasted (logged as waste
// with it, Log Waste) — with an approver's PIN when that's over the limit.
export const cancelLineSchema = z
  .object({
    orderId: idSchema,
    version: orderVersionSchema,
    lineId: idSchema,
    ...reason,
    wasted: z.boolean().default(false),
    approval: z.object({ approverId: idSchema, pin: pinSchema }).optional(),
  })
  .refine(otherNeedsDetails, OTHER_MESSAGE)
  .refine((value) => !value.wasted || value.reason === "RETURNED_BY_GUEST", { message: "Only food returned by the guest is logged as waste here.", path: ["wasted"] });

export const cancelOrderSchema = z
  .object({ orderId: idSchema, version: orderVersionSchema, ...reason })
  .refine(otherNeedsDetails, OTHER_MESSAGE)
  .refine((value) => value.reason !== "RETURNED_BY_GUEST", { message: "Returned by guest is for a served line, not a whole order.", path: ["reason"] });

export type CancelLineInput = z.infer<typeof cancelLineSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// Move table / Merge, from the floor plan (the moving order's version).
export const moveOrderSchema = z.object({ orderId: idSchema, version: orderVersionSchema, tableId: idSchema });
export const mergeOrdersSchema = z.object({ orderId: idSchema, version: orderVersionSchema, targetOrderId: idSchema });
