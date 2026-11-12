import { z } from "zod";
import { FIXTURE_TYPES, type FixtureType } from "./floorGeometry";

// Event layouts (Part 7 Step 5): an area's floor saved under a name
// ("Wedding setup") and put back on the floor later.
//
// - "Save as layout…" keeps a copy of the area's floor as saved.
// - "Switch layout" puts one on the floor. The first time an event layout
//   replaces the everyday floor, that floor is kept as the area's "normal"
//   snapshot, for "Restore normal".
// - While an event layout is showing, SAVE keeps it up to date: you're
//   editing that layout.
//
// A snapshot is FloorLayout.snapshot (JSON), checked with this schema
// whenever it's read back.

export const LAYOUT_NAME_MAX = 40;
export const MAX_LAYOUTS = 20;
export const NORMAL_NAME = "Normal layout";

const box = { x: z.number(), y: z.number(), w: z.number(), h: z.number(), rotation: z.number().int() };
export const layoutSnapshotSchema = z.object({
  v: z.literal(1),
  kind: z.enum(["event", "normal"]),
  room: z.object({ widthM: z.number(), heightM: z.number(), gridM: z.number() }),
  tables: z.array(z.object({ id: z.string(), name: z.string(), seats: z.number().int(), shape: z.enum(["ROUND", "SQUARE", "RECT", "BOOTH"]), ...box })),
  fixtures: z.array(z.object({ id: z.string(), type: z.enum(FIXTURE_TYPES as [FixtureType, ...FixtureType[]]), label: z.string(), ...box })),
});
export type LayoutSnapshot = z.infer<typeof layoutSnapshotSchema>;

// "12 tables · 46 seats"
export function snapshotSummary(snapshot: Pick<LayoutSnapshot, "tables">): string {
  const tables = snapshot.tables.length;
  const seats = snapshot.tables.reduce((n, t) => n + t.seats, 0);
  return `${tables} table${tables === 1 ? "" : "s"} · ${seats} seat${seats === 1 ? "" : "s"}`;
}

// Names are compared ignoring case and the spaces around them.
export const layoutKey = (name: string) => name.trim().toLowerCase();
