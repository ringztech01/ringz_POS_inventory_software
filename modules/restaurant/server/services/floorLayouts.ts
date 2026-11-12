import "server-only";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { MAX_LAYOUTS, NORMAL_NAME, layoutKey, layoutSnapshotSchema, snapshotSummary, type LayoutSnapshot } from "../../lib/floorLayouts";
import { shortName } from "../../lib/floorRules";
import { formatAppDateTime } from "../../lib/time";
import type { FloorLayoutDeleteInput, FloorLayoutSaveInput, FloorLayoutSwitchInput } from "../../schemas/floorPlan";
import { captureSnapshot, refusal, Refused, savePlansInTx, type FloorSaveResult } from "./floorPlan";

// Event layouts (Part 7 Step 5) — see lib/floorLayouts.ts for how they
// work. Every one of these needs Manage Floor Plan (the actions check) and
// is written to the audit log.

// saved: when and by whom, for people ("10 Nov 2026, 14:05 · Grace M.").
export type EditorLayout = { id: string; name: string; isActive: boolean; summary: string; saved: string };
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; exists?: boolean };

type LayoutRow = { id: string; name: string; isActive: boolean; snapshot: Prisma.JsonValue; updatedAt: Date; createdBy: { firstName: string; lastName: string } };
const kindOf = (row: { snapshot: Prisma.JsonValue }) => ((row.snapshot as { kind?: unknown } | null)?.kind === "normal" ? "normal" : "event");
const readSnapshot = (row: { snapshot: Prisma.JsonValue }): LayoutSnapshot | null => {
  const parsed = layoutSnapshotSchema.safeParse(row.snapshot);
  return parsed.success ? parsed.data : null;
};

// For the editor: each area's saved event layouts (newest first), which is
// on the floor, and whether there's a normal floor to go back to.
export async function getAreaLayouts(areaIds: string[]): Promise<Record<string, { layouts: EditorLayout[]; hasNormal: boolean }>> {
  const rows = await prisma.floorLayout.findMany({
    where: { areaId: { in: areaIds } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, areaId: true, name: true, isActive: true, snapshot: true, updatedAt: true, createdBy: { select: { firstName: true, lastName: true } } },
  });
  const out: Record<string, { layouts: EditorLayout[]; hasNormal: boolean }> = Object.fromEntries(areaIds.map((id) => [id, { layouts: [], hasNormal: false }]));
  for (const row of rows) {
    const entry = out[row.areaId];
    if (!entry) continue;
    if (kindOf(row) === "normal") {
      entry.hasNormal = true;
      continue;
    }
    const snapshot = readSnapshot(row);
    entry.layouts.push({
      id: row.id,
      name: row.name,
      isActive: row.isActive,
      summary: snapshot ? snapshotSummary(snapshot) : "Can't be read",
      saved: `${formatAppDateTime(row.updatedAt)} · ${shortName(row.createdBy.firstName, row.createdBy.lastName)}`,
    });
  }
  return out;
}

type LockedArea = { id: string; name: string; deletedAt: Date | null };
async function lockArea(tx: Prisma.TransactionClient, areaId: string): Promise<LockedArea> {
  const area = (await tx.$queryRaw<LockedArea[]>`SELECT id, name, deletedAt FROM DiningArea WHERE id = ${areaId} FOR UPDATE`)[0];
  if (!area || area.deletedAt) throw new Refused("That dining area has been deleted. Reload the floor plan.", true, areaId);
  return area;
}
const layoutsOf = (tx: Prisma.TransactionClient, areaId: string): Promise<LayoutRow[]> =>
  tx.floorLayout.findMany({ where: { areaId }, select: { id: true, name: true, isActive: true, snapshot: true, updatedAt: true, createdBy: { select: { firstName: true, lastName: true } } } });

// "Save as layout…": the area's floor as saved, under a name. A name
// already used is refused unless `replace` (the editor asks first).
export async function saveFloorLayout(input: FloorLayoutSaveInput, userId: string): Promise<Result<{ layoutId: string; replaced: boolean }>> {
  const name = input.name.trim();
  try {
    return await prisma.$transaction(async (tx) => {
      const area = await lockArea(tx, input.areaId);
      const events = (await layoutsOf(tx, area.id)).filter((l) => kindOf(l) === "event");
      const same = events.find((l) => layoutKey(l.name) === layoutKey(name));
      if (same && !input.replace) return { ok: false as const, error: `There's already a layout called “${same.name}”.`, exists: true };
      if (!same && events.length >= MAX_LAYOUTS) return { ok: false as const, error: `${area.name} has ${MAX_LAYOUTS} saved layouts already. Delete one first.` };
      const snapshot = await captureSnapshot(tx, area.id, "event");
      const row = same
        ? await tx.floorLayout.update({ where: { id: same.id }, data: { name, snapshot, createdById: userId }, select: { id: true } })
        : await tx.floorLayout.create({ data: { areaId: area.id, name, snapshot, createdById: userId }, select: { id: true } });
      await writeAudit(
        { userId, action: "floor.layout.saveAs", entityType: "DiningArea", entityId: area.id, meta: { area: area.name, layout: name, replaced: !!same, summary: snapshotSummary(snapshot) } },
        tx,
      );
      return { ok: true as const, layoutId: row.id, replaced: !!same };
    });
  } catch (error) {
    const refused = refusal(error);
    if (refused) return refused;
    throw error;
  }
}

// "Switch layout" (layoutId) or "Restore normal" (null): puts that floor on
// the area, through the same checks as SAVE — the version the editor shows,
// not locked, inside the room, no overlaps, numbers unique, and no table
// taken off that has an open order (or a booking today). The first switch
// away from the everyday floor keeps it as the normal snapshot; restoring
// it puts it back and lets the snapshot go.
export async function switchFloorLayout(input: FloorLayoutSwitchInput, userId: string): Promise<FloorSaveResult & { name?: string }> {
  let targetName = NORMAL_NAME;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const area = await lockArea(tx, input.areaId);
      const layouts = await layoutsOf(tx, area.id);
      const current = layouts.find((l) => l.isActive) ?? null;
      const normal = layouts.find((l) => kindOf(l) === "normal") ?? null;
      const target = input.layoutId ? layouts.find((l) => l.id === input.layoutId && kindOf(l) === "event") : normal;
      if (input.layoutId && !target) throw new Refused("That layout has been deleted. Reload the floor plan.", true, area.id);
      if (!input.layoutId && !current) throw new Refused("The normal layout is already on the floor.");
      if (!target) throw new Refused("There's no normal layout kept for this area. Switch to the layout you want instead.");
      targetName = input.layoutId ? target.name : NORMAL_NAME;
      if (current && current.id === target.id) throw new Refused(`“${target.name}” is already on the floor.`);
      const snapshot = readSnapshot(target);
      if (!snapshot) throw new Refused(`“${targetName}” can't be read. Delete it and save it again.`);

      // Leaving the everyday floor: keep it for Restore normal.
      if (!current) {
        if (normal) await tx.floorLayout.delete({ where: { id: normal.id } });
        await tx.floorLayout.create({ data: { areaId: area.id, name: NORMAL_NAME, snapshot: await captureSnapshot(tx, area.id, "normal"), createdById: userId } });
      }
      // Which layout is on the floor (one per area: the old one off first).
      if (current) await tx.floorLayout.update({ where: { id: current.id }, data: { isActive: false } });
      if (input.layoutId) await tx.floorLayout.update({ where: { id: target.id }, data: { isActive: true } });

      // The snapshot's rows that are still this area's (on the floor or
      // taken off) come back as themselves; anything else is added new.
      const [tables, fixtures] = await Promise.all([
        tx.table.findMany({ where: { areaId: area.id, id: { in: snapshot.tables.map((t) => t.id) } }, select: { id: true } }),
        tx.floorFixture.findMany({ where: { areaId: area.id, id: { in: snapshot.fixtures.map((f) => f.id) } }, select: { id: true } }),
      ]);
      const ownTables = new Set(tables.map((t) => t.id));
      const ownFixtures = new Set(fixtures.map((f) => f.id));
      const saved = await savePlansInTx(
        tx,
        {
          areas: [
            {
              areaId: area.id,
              layoutVersion: input.layoutVersion,
              room: snapshot.room,
              tables: snapshot.tables.map(({ id, ...t }) => ({ ...t, ...(ownTables.has(id) ? { id } : {}) })),
              fixtures: snapshot.fixtures.map(({ id, ...f }) => ({ ...f, ...(ownFixtures.has(id) ? { id } : {}) })),
            },
          ],
        },
        userId,
        { action: input.layoutId ? "floor.layout.switch" : "floor.layout.restore", meta: { fromLayout: current?.name ?? NORMAL_NAME, toLayout: targetName } },
      );
      // Back to normal: the kept snapshot has done its job.
      if (!input.layoutId && normal) await tx.floorLayout.delete({ where: { id: normal.id } });
      return saved;
    });
    return { ok: true, ...result, name: targetName };
  } catch (error) {
    const refused = refusal(error, `Can't switch to “${targetName}”: `);
    if (refused) return refused;
    throw error;
  }
}

// Delete a saved layout (not the one on the floor).
export async function deleteFloorLayout(input: FloorLayoutDeleteInput, userId: string): Promise<Result> {
  return prisma.$transaction(async (tx) => {
    const layout = await tx.floorLayout.findUnique({ where: { id: input.layoutId }, select: { id: true, name: true, isActive: true, areaId: true, snapshot: true } });
    if (!layout || kindOf(layout) !== "event") return { ok: false as const, error: "That layout has already been deleted." };
    const area = await tx.$queryRaw<LockedArea[]>`SELECT id, name, deletedAt FROM DiningArea WHERE id = ${layout.areaId} FOR UPDATE`;
    const fresh = await tx.floorLayout.findUnique({ where: { id: layout.id }, select: { isActive: true } });
    if (fresh?.isActive) return { ok: false as const, error: `“${layout.name}” is on the floor. Switch to another layout (or Restore normal) first.` };
    await tx.floorLayout.delete({ where: { id: layout.id } });
    await writeAudit({ userId, action: "floor.layout.delete", entityType: "DiningArea", entityId: layout.areaId, meta: { area: area[0]?.name ?? null, layout: layout.name } }, tx);
    return { ok: true as const };
  });
}
