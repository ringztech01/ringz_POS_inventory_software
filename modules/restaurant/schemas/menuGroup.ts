import { z } from "zod";
import { MAX_QUICK_NOTES, QUICK_NOTE_MAX } from "../lib/optionFlow";
import { GRID_SLOTS } from "../lib/posGrid";
import { idSchema } from "./common";

export const MENU_GROUP_NAME_MAX = 40;
// Up to 20 pages of buttons in one grid.
export const MAX_GRID_CELL = GRID_SLOTS * 20 - 1;

const department = z.enum(["FOOD", "BAR"], { message: "Pick Food or Bar." });

// A touch-POS button group (Food › POS buttons). A sub-group takes its
// parent's department whatever is sent; the parent must be in the same
// department and not the group itself or one inside it (checked server-side).
export const menuGroupSchema = z.object({
  name: z
    .string({ message: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(MENU_GROUP_NAME_MAX, `Name can be at most ${MENU_GROUP_NAME_MAX} characters.`),
  department,
  parentId: idSchema.nullable(),
  // "#B4501A", or none for the automatic colour.
  colour: z
    .string()
    .trim()
    .regex(/^(#[0-9a-fA-F]{6})?$/, "Pick a colour from the list.")
    .nullable()
    .transform((value) => (value ? value.toUpperCase() : null)),
});

export type MenuGroupInput = z.output<typeof menuGroupSchema>;
export type MenuGroupField = keyof z.input<typeof menuGroupSchema>;

// Drop a button on a cell of one grid: a department's home (groupId null,
// groups only) or a group's (its sub-groups and dishes). A dish dropped on a
// group's grid moves into that group.
export const placeButtonSchema = z.object({
  kind: z.enum(["group", "item"]),
  id: idSchema,
  department,
  groupId: idSchema.nullable(),
  cell: z.number().int().min(0).max(MAX_GRID_CELL),
});
export type PlaceButtonInput = z.output<typeof placeButtonSchema>;

// The Note keypad's quick notes, in order.
export const quickNotesSchema = z
  .array(z.string().trim().min(1, "A quick note can't be empty.").max(QUICK_NOTE_MAX, `A quick note can be at most ${QUICK_NOTE_MAX} characters.`))
  .max(MAX_QUICK_NOTES, `At most ${MAX_QUICK_NOTES} quick notes.`)
  .refine((list) => new Set(list.map((n) => n.toLowerCase())).size === list.length, "Each quick note only once.");

export const moveGroupRankSchema = z.object({ id: idSchema, direction: z.enum(["up", "down"]) });
