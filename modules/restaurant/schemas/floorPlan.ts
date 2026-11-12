import { z } from "zod";
import { FIXTURE_TYPES, GRID_SIZES_M, isTenthMetre, MIN_SIZE_M, ROOM_LIMITS_M, ROTATIONS, type FixtureType } from "../lib/floorGeometry";
import { OPACITY_LIMITS } from "../lib/floorImage";
import { LAYOUT_NAME_MAX, layoutKey, NORMAL_NAME } from "../lib/floorLayouts";
import { idSchema } from "./common";
import { MAX_SEATS, TABLE_NAME_MAX } from "./table";

// The floor plan editor's save (Part 7): every area changed, each with the
// layout version it was edited from and its tables and fixtures as they
// stand — tables or fixtures left out are removed. Metres from the room's
// top-left corner. The server checks the rest (inside the room, overlaps,
// unique numbers, nothing removed that's in use) in one transaction.
const metres = z.number({ message: "Positions are in metres." }).finite().min(0).max(ROOM_LIMITS_M.max);
const rotation = z
  .number()
  .int()
  .refine((r) => (ROTATIONS as readonly number[]).includes(r), "Rotation is a step of 45°.");

// key: the editor's own name for a new item, so the save can say which id
// each new one got (and Undo after a save still points at the same rows).
const clientKey = z.string().min(1).max(64).optional();

export const floorTableSchema = z.object({
  id: idSchema.optional(),
  key: clientKey,
  name: z.string().trim().min(1, "Every table needs a number.").max(TABLE_NAME_MAX, `A table number is at most ${TABLE_NAME_MAX} characters.`),
  seats: z.number().int().min(1).max(MAX_SEATS, `A table seats at most ${MAX_SEATS}.`),
  shape: z.enum(["ROUND", "SQUARE", "RECT", "BOOTH"]),
  x: metres,
  y: metres,
  w: metres.min(MIN_SIZE_M.table),
  h: metres.min(MIN_SIZE_M.table),
  rotation,
});

export const floorFixtureSchema = z.object({
  id: idSchema.optional(),
  key: clientKey,
  type: z.enum(FIXTURE_TYPES as [FixtureType, ...FixtureType[]]),
  label: z.string().trim().min(1, "A fixture needs a label.").max(40),
  x: metres,
  y: metres,
  w: metres.min(MIN_SIZE_M.fixture),
  h: metres.min(MIN_SIZE_M.fixture),
  rotation,
});

// The room's size and dot grid (Step 3). Left out: unchanged. Shrinking it
// is refused while anything would fall outside (checked in the save).
const roomSide = z
  .number({ message: "The room's size is in metres." })
  .finite()
  .min(ROOM_LIMITS_M.min, `A room is at least ${ROOM_LIMITS_M.min} m each way.`)
  .max(ROOM_LIMITS_M.max, `A room is at most ${ROOM_LIMITS_M.max} m each way.`)
  .refine(isTenthMetre, "Room sizes go in steps of 10 cm.");
export const floorRoomSchema = z.object({
  widthM: roomSide,
  heightM: roomSide,
  gridM: z.number().refine((g) => (GRID_SIZES_M as readonly number[]).includes(g), `The grid is ${GRID_SIZES_M.join(", ")} m.`),
});

export const floorAreaPlanSchema = z.object({
  areaId: idSchema,
  layoutVersion: z.number().int().min(0),
  room: floorRoomSchema.optional(),
  tables: z.array(floorTableSchema).max(300),
  fixtures: z.array(floorFixtureSchema).max(300),
});

export const saveFloorPlanSchema = z.object({ areas: z.array(floorAreaPlanSchema).min(1).max(30) });
export type SaveFloorPlanInput = z.infer<typeof saveFloorPlanSchema>;
export type FloorAreaPlan = z.infer<typeof floorAreaPlanSchema>;

export const floorLockSchema = z.object({ areaId: idSchema, locked: z.boolean() });

// After a save: how many service screens have drawn these versions yet.
export const floorReachSchema = z.object({ versions: z.record(idSchema, z.number().int().min(0)) });

// The floor plan image (Administrator only — the actions check). Opacity
// while tracing; calibration: its scale (image pixels per real metre) and
// where its top-left corner sits in the room (metres), or null to clear it.
export const floorImageAreaSchema = z.object({ areaId: idSchema });
export const floorImageAdjustSchema = z
  .object({
    areaId: idSchema,
    opacity: z.number().min(OPACITY_LIMITS.min).max(OPACITY_LIMITS.max).optional(),
    calibration: z
      .object({
        scale: z.number().finite().positive().max(100000),
        offset: z.object({ x: z.number().finite().min(-1000).max(1000), y: z.number().finite().min(-1000).max(1000) }),
      })
      .nullable()
      .optional(),
  })
  .refine((input) => input.opacity !== undefined || input.calibration !== undefined, "Nothing to change.");
export type FloorImageAdjustInput = z.infer<typeof floorImageAdjustSchema>;

// Event layouts (Step 5). Save as: a name (not the everyday floor's own);
// replace: yes, overwrite the one with that name. Switch: to a saved layout,
// or null for the normal floor, from the version the editor shows.
export const floorLayoutSaveSchema = z.object({
  areaId: idSchema,
  name: z
    .string()
    .trim()
    .min(1, "Give the layout a name.")
    .max(LAYOUT_NAME_MAX, `A layout name is at most ${LAYOUT_NAME_MAX} characters.`)
    .refine((name) => layoutKey(name) !== layoutKey(NORMAL_NAME), `“${NORMAL_NAME}” is the everyday floor's name. Pick another.`),
  replace: z.boolean().optional(),
});
export const floorLayoutSwitchSchema = z.object({ areaId: idSchema, layoutVersion: z.number().int().min(0), layoutId: idSchema.nullable() });
export const floorLayoutDeleteSchema = z.object({ layoutId: idSchema });
export type FloorLayoutSaveInput = z.infer<typeof floorLayoutSaveSchema>;
export type FloorLayoutSwitchInput = z.infer<typeof floorLayoutSwitchSchema>;
export type FloorLayoutDeleteInput = z.infer<typeof floorLayoutDeleteSchema>;
