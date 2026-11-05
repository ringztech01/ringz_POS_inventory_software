import { z } from "zod";
import { pinSchema } from "./bill";
import { idSchema } from "./common";

export const WASTE_NOTE_MAX = 300;
export const WASTE_REASONS = ["BURNT", "EXPIRED", "DROPPED", "RETURNED_BY_GUEST", "OVERPRODUCTION", "OTHER"] as const;

const qtySchema = z
  .string({ message: "Enter the quantity." })
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter a quantity like 2 or 0.5.")
  .refine((value) => Number(value) > 0, "The quantity must be more than 0.");

// Log waste: the item (a menu item or an ingredient), how much in its own
// unit, why — a note is required for Other — and, from an order line, which
// one. Above the approval limit it also carries the approver and their PIN
// (checked on the server, as the cost is). Never a cost: the server works it
// out.
export const logWasteSchema = z
  .object({
    productId: idSchema,
    qty: qtySchema,
    unit: z.string().trim().min(1, "Choose the unit.").max(20),
    reason: z.enum(WASTE_REASONS, { message: "Choose a reason." }),
    note: z.string().trim().max(WASTE_NOTE_MAX, `The note can be at most ${WASTE_NOTE_MAX} characters.`).default(""),
    orderItemId: idSchema.optional(),
    approval: z.object({ approverId: idSchema, pin: pinSchema }).optional(),
  })
  .refine((d) => d.reason !== "OTHER" || d.note.length > 0, { message: "Say what happened (needed for Other).", path: ["note"] });

export type LogWasteInput = z.infer<typeof logWasteSchema>;
export type LogWasteField = keyof z.input<typeof logWasteSchema>;

// The Log waste form's live cost: the item and how much (nothing written).
export const previewWasteSchema = z.object({ productId: idSchema, qty: qtySchema });

// Remake (the kitchen display): a line being made or ready is spoilt — how
// many of it (whole dishes, at most the line's), Burnt or Dropped, a note —
// logged as waste and made again at no charge.
export const REMAKE_REASONS = ["BURNT", "DROPPED"] as const;
export const remakeSchema = z.object({
  itemId: idSchema,
  qty: z.number({ message: "Enter how many." }).int("Remake whole dishes.").min(1, "Remake at least 1.").max(999),
  reason: z.enum(REMAKE_REASONS, { message: "Choose Burnt or Dropped." }),
  note: z.string().trim().max(WASTE_NOTE_MAX, `The note can be at most ${WASTE_NOTE_MAX} characters.`).default(""),
  approval: z.object({ approverId: idSchema, pin: pinSchema }).optional(),
});

export type RemakeInput = z.infer<typeof remakeSchema>;

// Void a waste entry (Approve Waste): why, and the version its screen showed.
export const voidWasteSchema = z.object({
  id: idSchema,
  reason: z.string().trim().min(1, "Give a reason for the void.").max(WASTE_NOTE_MAX, `The reason can be at most ${WASTE_NOTE_MAX} characters.`),
  version: z.number().int().min(0),
});

export type VoidWasteInput = z.infer<typeof voidWasteSchema>;
