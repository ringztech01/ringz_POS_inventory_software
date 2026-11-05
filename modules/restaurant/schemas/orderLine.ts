import { z } from "zod";
import { MAX_LINE_QUANTITY, NOTE_MAX } from "../lib/modifiers";
import { idSchema } from "./common";
import { orderVersionSchema } from "./order";

// What the browser may send about a line: the dish, the chosen option ids
// and a note — never a price. The server looks prices up and snapshots them;
// anything else sent (a unitPrice, say) is dropped by these schemas.

const modifierIds = z.array(idSchema).max(30, "Too many options.");
const note = z
  .string()
  .trim()
  .max(NOTE_MAX, `The note can be at most ${NOTE_MAX} characters.`)
  .transform((value) => value || null);

export const addLineSchema = z.object({
  orderId: idSchema,
  version: orderVersionSchema,
  productId: idSchema,
  modifierIds,
  note,
});

export const editLineSchema = z.object({
  orderId: idSchema,
  version: orderVersionSchema,
  lineId: idSchema,
  modifierIds,
  note,
});

// 0 removes the line (it was never sent).
export const lineQuantitySchema = z.object({
  orderId: idSchema,
  version: orderVersionSchema,
  lineId: idSchema,
  quantity: z.number().int().min(0).max(MAX_LINE_QUANTITY),
});

export type AddLineInput = z.infer<typeof addLineSchema>;
export type EditLineInput = z.infer<typeof editLineSchema>;
export type LineQuantityInput = z.infer<typeof lineQuantitySchema>;
