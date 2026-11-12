import "server-only";
import { prisma } from "@/lib/db";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { currentDeviceId } from "@/lib/hardware/device";
import { createPresence } from "../lib/floorPresence";

// Which tablets are showing the floor, and which layout they last drew
// (Part 7 Step 4: "Saved v13 · N tablets updated"). The service screens
// (Restaurant › Floor, the POS tables screen) re-render from the server every
// 5 s while visible (FloorPolling); each render notes here the device and the
// layout version of every area it drew. A screen not heard from for 20 s
// (closed, or a hidden tab — it stops polling) no longer counts.
//
// Kept in this server's memory: nothing to store, gone on a restart (the
// screens are counted again within 5 s). One app server, as this app runs.

const store = globalThis as unknown as { __ringzFloorPresence?: ReturnType<typeof createPresence> };
const presence = (store.__ringzFloorPresence ??= createPresence());

export const floorReach = (target: Record<string, number>) => presence.reach(target);

// Called by the service floor pages as they render: this device (or, with
// no device cookie yet, this signed-in user) and every live area's version.
export async function noteFloorViewer(): Promise<void> {
  try {
    const viewer = (await currentDeviceId()) ?? (await getCurrentUserPermissions()).userId;
    if (!viewer) return;
    const areas = await prisma.diningArea.findMany({ where: { deletedAt: null }, select: { id: true, layoutVersion: true } });
    presence.note(viewer, Object.fromEntries(areas.map((a) => [a.id, a.layoutVersion])));
  } catch (error) {
    console.warn("[restaurant] couldn't note a floor viewer:", error);
  }
}
