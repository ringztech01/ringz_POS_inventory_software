import "server-only";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { todayInAppZone } from "@/lib/dateRanges";
import { insideRoom, itemsOverlap, numberKey } from "../../lib/floorGeometry";
import type { LayoutSnapshot } from "../../lib/floorLayouts";
import { bookingReason, changedBy, openOrderReason, shortName } from "../../lib/floorRules";
import { appDayBounds, formatAppTime } from "../../lib/time";
import { newQrToken } from "../../lib/qrToken";
import type { SaveFloorPlanInput } from "../../schemas/floorPlan";
import { isUniqueViolation } from "../prismaErrors";

export type FloorSaveResult =
  // created: the editor's key for each new table or fixture → its new id.
  | { ok: true; versions: Record<string, number>; created: Record<string, string> }
  // stale: someone else saved the area first (areaId: which one).
  | { ok: false; error: string; stale?: boolean; areaId?: string };

// Thrown inside the transaction to roll it back with a message (nothing of
// a refused save is written); caught below and returned.
export class Refused extends Error {
  constructor(
    message: string,
    readonly stale = false,
    readonly areaId?: string,
  ) {
    super(message);
  }
}

type AreaRow = { id: string; name: string; layoutVersion: number; roomWidthM: string; roomHeightM: string; isLocked: number | boolean; deletedAt: Date | null };
export const LAYOUT_SAVE = "floor.layout.save";

// Who saved the area's current version, from the audit log — "Grace M." —
// or null when the version came from somewhere else (the Tables screen).
async function savedBy(tx: Prisma.TransactionClient, areaId: string, version: number): Promise<string | null> {
  const last = await tx.auditLog.findFirst({
    where: { entityType: "DiningArea", entityId: areaId, action: LAYOUT_SAVE },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { meta: true, user: { select: { firstName: true, lastName: true } } },
  });
  const to = (last?.meta as { to?: unknown } | null)?.to;
  return last?.user && to === version ? shortName(last.user.firstName, last.user.lastName) : null;
}

// Save the floor plan editor's changes (Part 7) — every changed area in one
// transaction, each against the layout version it was edited from, so two
// admins never overwrite each other unawares ("Layout changed by Grace M.
// Reload?"). Checked first, for every area, before anything is written:
//   - the area is live, not locked, and still at that version;
//   - every table and fixture is inside the room (its rotated box) — the
//     room's new size, if it's being changed (so it can't shrink past them);
//   - no two tables overlap (fixtures may);
//   - table numbers are unique across the business (live tables);
//   - a table taken off has no open order and no booking today.
// Then tables and fixtures are created, changed, brought back (a removal
// undone in the editor: the same table, its QR code and history kept) or
// taken off (soft-deleted), the room's size and grid are written, each
// area's layout version moves on by one, and each save is in the audit log
// (who, from which version to which, what changed).
export async function saveFloorPlan(input: SaveFloorPlanInput, userId: string | null = null): Promise<FloorSaveResult> {
  try {
    return { ok: true, ...(await prisma.$transaction((tx) => savePlansInTx(tx, input, userId))) };
  } catch (error) {
    const refused = refusal(error);
    if (refused) return refused;
    throw error;
  }
}

// A refusal thrown by savePlansInTx as the action's answer; null for
// anything else (a real error, re-thrown by the caller).
export function refusal(error: unknown, prefix = ""): Extract<FloorSaveResult, { ok: false }> | null {
  if (error instanceof Refused) return { ok: false, error: error.stale ? error.message : prefix + error.message, ...(error.stale ? { stale: true, areaId: error.areaId } : {}) };
  if (isUniqueViolation(error, "activeName")) return { ok: false, error: prefix + "A table number on this plan was just used elsewhere. Pick another number." };
  return null;
}

// The save itself, inside the caller's transaction (SAVE, and putting an
// event layout on the floor — Step 5 — which is checked exactly the same
// way). Throws Refused. `audit`: what the audit log calls it.
export async function savePlansInTx(
  tx: Prisma.TransactionClient,
  input: SaveFloorPlanInput,
  userId: string | null,
  audit: { action: string; meta?: Record<string, Prisma.InputJsonValue> } = { action: LAYOUT_SAVE },
): Promise<{ versions: Record<string, number>; created: Record<string, string> }> {
  const plans = [...input.areas].sort((a, b) => a.areaId.localeCompare(b.areaId));
  // ---- Check
  const areas = new Map<string, AreaRow>();
  for (const plan of plans) {
    const rows = await tx.$queryRaw<AreaRow[]>`
      SELECT id, name, layoutVersion, roomWidthM, roomHeightM, isLocked, deletedAt FROM DiningArea WHERE id = ${plan.areaId} FOR UPDATE`;
    const area = rows[0];
    if (!area || area.deletedAt) throw new Refused("That dining area has been deleted. Reload the floor plan.", true, plan.areaId);
    if (area.isLocked) throw new Refused(`${area.name} is locked. Unlock it to change its layout.`);
    if (area.layoutVersion !== plan.layoutVersion) throw new Refused(changedBy(await savedBy(tx, area.id, area.layoutVersion), area.layoutVersion), true, area.id);
    areas.set(plan.areaId, area);
    // The room as saved, or its new size (Step 3) — a smaller room is
    // refused while anything would fall outside it.
    const stored = { widthM: Number(area.roomWidthM), heightM: Number(area.roomHeightM) };
    const room = plan.room ?? stored;
    const resized = room.widthM !== stored.widthM || room.heightM !== stored.heightM;
    const outside = (what: string) =>
      resized
        ? `${area.name} can't be ${room.widthM} × ${room.heightM} m: ${what} would be outside it. Move it first, or keep the room bigger.`
        : `${what} is outside ${area.name}'s room.`;
    for (const t of plan.tables) if (!insideRoom(t, room)) throw new Refused(outside(`Table ${t.name}`));
    for (const f of plan.fixtures) if (!insideRoom(f, room)) throw new Refused(outside(f.label));
    for (let i = 0; i < plan.tables.length; i++)
      for (let j = i + 1; j < plan.tables.length; j++)
        if (itemsOverlap(plan.tables[i], plan.tables[j])) throw new Refused(`Tables ${plan.tables[i].name} and ${plan.tables[j].name} overlap. Move one apart.`);
  }

  const areaIds = plans.map((p) => p.areaId);
  const submitted = plans.flatMap((p) => p.tables.map((t) => ({ ...t, areaId: p.areaId })));
  const submittedIds = submitted.flatMap((t) => (t.id ? [t.id] : []));
  // The live tables of these areas, and any taken off that the plan
  // brings back (a removal undone).
  const known = await tx.table.findMany({
    where: { areaId: { in: areaIds }, OR: [{ deletedAt: null }, { id: { in: submittedIds } }] },
    select: { id: true, name: true, areaId: true, deletedAt: true },
  });
  const existing = known.filter((t) => !t.deletedAt);
  for (const t of submitted) {
    if (t.id && !known.some((e) => e.id === t.id && e.areaId === t.areaId)) throw new Refused(`Table ${t.name} is no longer on this floor plan. Reload it.`, true, t.areaId);
  }
  // Unique numbers: among the tables saved, and against every other area.
  const seen = new Map<string, string>();
  for (const t of submitted) {
    if (seen.has(numberKey(t.name))) throw new Refused(`Two tables are numbered ${t.name}. Each number can be used once.`);
    seen.set(numberKey(t.name), t.name);
  }
  const elsewhere = await tx.table.findMany({
    where: { deletedAt: null, areaId: { notIn: areaIds }, name: { in: submitted.map((t) => t.name) } },
    select: { name: true, area: { select: { name: true } } },
  });
  if (elsewhere.length) throw new Refused(`Table number ${elsewhere[0].name} is already used in ${elsewhere[0].area.name}.`);

  // Taken off: not while it has an open order or a booking today.
  const keptIds = new Set(submittedIds);
  const removed = existing.filter((e) => !keptIds.has(e.id));
  if (removed.length) {
    const busy = await tx.order.findFirst({ where: { tableId: { in: removed.map((r) => r.id) }, activeTableId: { not: null } }, select: { table: { select: { name: true } } } });
    if (busy) throw new Refused(openOrderReason(busy.table?.name ?? ""));
    const { start, end } = appDayBounds(todayInAppZone());
    const booked = await tx.reservation.findFirst({
      where: { tableId: { in: removed.map((r) => r.id) }, status: "BOOKED", deletedAt: null, startsAt: { gte: start, lt: end } },
      orderBy: { startsAt: "asc" },
      select: { guestName: true, startsAt: true, table: { select: { name: true } } },
    });
    if (booked) throw new Refused(bookingReason(booked.table.name, booked.guestName, formatAppTime(booked.startsAt)));
  }

  // ---- Write. Taken off first, so a number freed by one table can go
  // to another in the same save.
  const now = new Date();
  const versions: Record<string, number> = {};
  const created: Record<string, string> = {};
  const gone = removed.map((r) => r.id);
  if (gone.length) await tx.table.updateMany({ where: { id: { in: gone } }, data: { deletedAt: now } });
  // Renumbered tables step aside first, so two can swap numbers (T1 ↔ T2)
  // without tripping the unique index halfway.
  for (const t of submitted) {
    const was = t.id ? known.find((k) => k.id === t.id && !k.deletedAt) : undefined;
    if (was && was.name !== t.name) await tx.table.update({ where: { id: was.id }, data: { name: `~${was.id}` } });
  }
  for (const plan of plans) {
    const area = areas.get(plan.areaId)!;
    const counts = { added: 0, changed: 0, restored: 0, removed: removed.filter((r) => r.areaId === plan.areaId).length, fixtures: 0 };
    for (const t of plan.tables) {
      const data = { name: t.name, seats: t.seats, shape: t.shape, x: t.x, y: t.y, w: t.w, h: t.h, rotation: t.rotation };
      const was = t.id ? known.find((k) => k.id === t.id) : undefined;
      if (was?.deletedAt) {
        await tx.table.update({ where: { id: was.id }, data: { ...data, deletedAt: null } });
        counts.restored++;
      } else if (was) {
        await tx.table.update({ where: { id: was.id }, data });
        counts.changed++;
      } else {
        const row = await tx.table.create({ data: { ...data, areaId: plan.areaId, qrToken: newQrToken() }, select: { id: true } });
        if (t.key) created[t.key] = row.id;
        counts.added++;
      }
    }
    const fixtureIds = plan.fixtures.flatMap((f) => (f.id ? [f.id] : []));
    const fixtures = await tx.floorFixture.findMany({ where: { areaId: plan.areaId, OR: [{ deletedAt: null }, { id: { in: fixtureIds } }] }, select: { id: true, deletedAt: true } });
    for (const f of plan.fixtures) {
      const data = { type: f.type, label: f.label, x: f.x, y: f.y, w: f.w, h: f.h, rotation: f.rotation, deletedAt: null };
      if (f.id && fixtures.some((e) => e.id === f.id)) await tx.floorFixture.update({ where: { id: f.id }, data });
      else {
        const row = await tx.floorFixture.create({ data: { ...data, areaId: plan.areaId }, select: { id: true } });
        if (f.key) created[f.key] = row.id;
      }
    }
    counts.fixtures = plan.fixtures.length;
    const goneFixtures = fixtures.filter((f) => !f.deletedAt && !fixtureIds.includes(f.id)).map((f) => f.id);
    if (goneFixtures.length) await tx.floorFixture.updateMany({ where: { id: { in: goneFixtures } }, data: { deletedAt: now } });
    const roomData = plan.room ? { roomWidthM: plan.room.widthM, roomHeightM: plan.room.heightM, gridSizeM: plan.room.gridM } : {};
    const version = (await tx.diningArea.update({ where: { id: plan.areaId }, data: { ...roomData, layoutVersion: { increment: 1 } }, select: { layoutVersion: true } })).layoutVersion;
    versions[plan.areaId] = version;
    // An event layout on the floor keeps up with its edits (Step 5).
    const active = await tx.floorLayout.findFirst({ where: { areaId: plan.areaId, isActive: true }, select: { id: true, name: true } });
    if (active) await tx.floorLayout.update({ where: { id: active.id }, data: { snapshot: await captureSnapshot(tx, plan.areaId, "event") } });
    await writeAudit(
      {
        userId,
        action: audit.action,
        entityType: "DiningArea",
        entityId: plan.areaId,
        meta: {
          ...audit.meta,
          area: area.name,
          ...(active ? { layout: active.name } : {}),
          from: area.layoutVersion,
          to: version,
          tables: { count: plan.tables.length, added: counts.added, changed: counts.changed, restored: counts.restored, removed: counts.removed },
          fixtures: { count: counts.fixtures, removed: goneFixtures.length },
          ...(plan.room ? { room: plan.room } : {}),
        },
      },
      tx,
    );
  }
  return { versions, created };
}

// The area's floor as it stands (saved), as an event layout or the
// normal-floor snapshot: the room, its live tables and fixtures (with
// their ids, so putting it back brings back the same rows).
export async function captureSnapshot(tx: Prisma.TransactionClient, areaId: string, kind: LayoutSnapshot["kind"]): Promise<LayoutSnapshot> {
  const area = await tx.diningArea.findUniqueOrThrow({
    where: { id: areaId },
    select: {
      roomWidthM: true,
      roomHeightM: true,
      gridSizeM: true,
      tables: { where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, seats: true, shape: true, x: true, y: true, w: true, h: true, rotation: true } },
      fixtures: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, label: true, x: true, y: true, w: true, h: true, rotation: true } },
    },
  });
  const metres = <T extends { x: Prisma.Decimal; y: Prisma.Decimal; w: Prisma.Decimal; h: Prisma.Decimal }>(row: T) => ({ ...row, x: Number(row.x), y: Number(row.y), w: Number(row.w), h: Number(row.h) });
  return {
    v: 1,
    kind,
    room: { widthM: Number(area.roomWidthM), heightM: Number(area.roomHeightM), gridM: Number(area.gridSizeM) },
    tables: area.tables.map(metres),
    fixtures: area.fixtures.map(metres),
  };
}

// Lock: the editor won't move or change anything in the area until it's
// unlocked (both need Manage Floor Plan — the action checks).
export async function setFloorLock(areaId: string, locked: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const updated = await prisma.diningArea.updateMany({ where: { id: areaId, deletedAt: null }, data: { isLocked: locked } });
  return updated.count ? { ok: true } : { ok: false, error: "That dining area has been deleted. Reload the floor plan." };
}
