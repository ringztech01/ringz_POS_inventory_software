import { z } from "zod";
import { MAX_LINE_QUANTITY, NOTE_MAX } from "../lib/modifiers";
import { MAX_GUESTS } from "../lib/orderLines";
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

// A line's seat (1–N) and course (touch POS); none: no seat / no course.
const seat = z.number().int().min(1).max(MAX_GUESTS).nullable();
const course = z.enum(["STARTER", "MAIN", "DESSERT"]).nullable();

// Qty first (the touch POS): several at once; seat and course as picked.
export const addLineSchema = z.object({
  orderId: idSchema,
  version: orderVersionSchema,
  productId: idSchema,
  modifierIds,
  note,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).default(1),
  seat: seat.default(null),
  course: course.default(null),
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

// Seat & course for lines (the touch POS): either or both; a field left out
// stays as it is. A course is for lines not sent yet.
export const placeLinesSchema = z
  .object({
    orderId: idSchema,
    version: orderVersionSchema,
    lineIds: z.array(idSchema).min(1).max(100),
    seat: seat.optional(),
    course: course.optional(),
  })
  .refine((v) => v.seat !== undefined || v.course !== undefined, { message: "Pick a seat or a course." });

// Hold (or release) lines not sent yet: Send leaves held lines until they're fired.
export const holdLinesSchema = z.object({ orderId: idSchema, version: orderVersionSchema, lineIds: z.array(idSchema).min(1).max(100), held: z.boolean() });

type AddLineOutput = z.infer<typeof addLineSchema>;
// Quantity, seat and course may be left out (1, none, none).
export type AddLineInput = Omit<AddLineOutput, "quantity" | "seat" | "course"> & Partial<Pick<AddLineOutput, "quantity" | "seat" | "course">>;
export type PlaceLinesInput = z.infer<typeof placeLinesSchema>;
export type HoldLinesInput = z.infer<typeof holdLinesSchema>;
export type EditLineInput = z.infer<typeof editLineSchema>;
export type LineQuantityInput = z.infer<typeof lineQuantitySchema>;
