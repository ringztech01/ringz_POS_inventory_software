// Which screens are showing the floor, and the layout they last drew — the
// bookkeeping behind the editor's "N tablets updated" (Part 7 Step 4). Kept
// pure for tests; server/floorPresence.ts holds the one live instance.

export const PRESENCE_WINDOW_MS = 20_000;

type Seen = { at: number; versions: Record<string, number> };

export function createPresence(windowMs = PRESENCE_WINDOW_MS) {
  const seen = new Map<string, Seen>();
  return {
    // A screen (device, or user) drew these area versions just now.
    note(viewer: string, versions: Record<string, number>, now = Date.now()) {
      seen.set(viewer, { at: now, versions });
    },
    // Of the screens heard from in the last `windowMs`, how many have drawn
    // at least these versions (areaId → version). Older ones are forgotten.
    reach(target: Record<string, number>, now = Date.now()): { showing: number; updated: number } {
      let showing = 0;
      let updated = 0;
      for (const [viewer, view] of seen) {
        if (now - view.at > windowMs) {
          seen.delete(viewer);
          continue;
        }
        showing++;
        if (Object.entries(target).every(([areaId, version]) => (view.versions[areaId] ?? -1) >= version)) updated++;
      }
      return { showing, updated };
    },
  };
}
