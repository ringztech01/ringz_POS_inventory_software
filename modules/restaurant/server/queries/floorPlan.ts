import "server-only";
import type { FloorFixtureType, TableShape } from "@prisma/client";
import { prisma } from "@/lib/db";
import { todayInAppZone } from "@/lib/dateRanges";
import { bookingReason, openOrderReason } from "../../lib/floorRules";
import { autoFloor, planSaved } from "../../lib/floorAuto";
import { appDayBounds, formatAppTime } from "../../lib/time";
import { toBackground, type FloorBackground } from "../services/floorImage";
import { getAreaLayouts, type EditorLayout } from "../services/floorLayouts";

// busy: why it can't be taken off the plan right now (an open order, a
// booking today), or null. The save checks again.
export type EditorTable = { id: string; name: string; seats: number; shape: TableShape; x: number; y: number; w: number; h: number; rotation: number; busy: string | null };
export type EditorFixture = { id: string; type: FloorFixtureType; label: string; x: number; y: number; w: number; h: number; rotation: number };
export type EditorArea = {
  id: string;
  name: string;
  // New table numbers here start with it ("T").
  prefix: string | null;
  room: { widthM: number; heightM: number; gridM: number };
  layoutVersion: number;
  isLocked: boolean;
  // Its floor plan image (drawn under the room while tracing; never in the
  // service view), or null.
  background: FloorBackground | null;
  tables: EditorTable[];
  fixtures: EditorFixture[];
  // Event layouts (Step 5): saved ones, newest first; the one on the floor
  // (isActive), and whether the normal floor is kept to go back to.
  layouts: EditorLayout[];
  hasNormal: boolean;
};

// Everything the floor plan editor draws: every live area (tab order) with
// its room, version and lock, its live tables and fixtures — metres as
// plain numbers.
export async function getFloorEditor(): Promise<EditorArea[]> {
  const areas = await prisma.diningArea.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      prefix: true,
      roomWidthM: true,
      roomHeightM: true,
      gridSizeM: true,
      layoutVersion: true,
      floorPlanSavedAt: true,
      isLocked: true,
      backgroundImage: true,
      backgroundOpacity: true,
      backgroundScale: true,
      backgroundOffset: true,
      tables: {
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, seats: true, shape: true, x: true, y: true, w: true, h: true, rotation: true },
      },
      fixtures: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, label: true, x: true, y: true, w: true, h: true, rotation: true },
      },
    },
  });
  const tableIds = areas.flatMap((a) => a.tables.map((t) => t.id));
  const { start, end } = appDayBounds(todayInAppZone());
  const [open, booked] = await Promise.all([
    prisma.order.findMany({ where: { tableId: { in: tableIds }, activeTableId: { not: null } }, select: { tableId: true } }),
    prisma.reservation.findMany({
      where: { tableId: { in: tableIds }, status: "BOOKED", deletedAt: null, startsAt: { gte: start, lt: end } },
      orderBy: { startsAt: "asc" },
      select: { tableId: true, guestName: true, startsAt: true },
    }),
  ]);
  const busy = (table: { id: string; name: string }) => {
    if (open.some((o) => o.tableId === table.id)) return openOrderReason(table.name);
    const booking = booked.find((b) => b.tableId === table.id);
    return booking ? bookingReason(table.name, booking.guestName, formatAppTime(booking.startsAt)) : null;
  };
  const layouts = await getAreaLayouts(areas.map((a) => a.id));
  const metres = <T extends { x: unknown; y: unknown; w: unknown; h: unknown }>(row: T) => ({ ...row, x: Number(row.x), y: Number(row.y), w: Number(row.w), h: Number(row.h) });
  return areas.map((area) => {
    // Never saved (6g follow-up 3): the editor starts from the grid every
    // floor draws for it; saving stores real places.
    const auto = planSaved(area.floorPlanSavedAt) ? null : autoFloor(area.tables.map((t) => ({ id: t.id, name: t.name, w: Number(t.w), h: Number(t.h) })), { widthM: Number(area.roomWidthM), heightM: Number(area.roomHeightM) });
    return {
    id: area.id,
    name: area.name,
    prefix: area.prefix,
    room: { widthM: auto ? auto.room.widthM : Number(area.roomWidthM), heightM: auto ? auto.room.heightM : Number(area.roomHeightM), gridM: Number(area.gridSizeM) },
    layoutVersion: area.layoutVersion,
    isLocked: area.isLocked,
    background: toBackground(area.id, area),
    tables: area.tables.map((t) => ({ ...metres(t), ...(auto?.places[t.id] ?? {}), busy: busy(t) })),
    layouts: layouts[area.id]?.layouts ?? [],
    hasNormal: layouts[area.id]?.hasNormal ?? false,
    fixtures: area.fixtures.map(metres),
    };
  });
}
