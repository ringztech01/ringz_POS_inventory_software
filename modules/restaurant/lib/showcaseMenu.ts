import type { Department } from "./posGrid";
import type { GuestStage } from "./guestOrdering";

// The Showcase guest menu's rules (design: RingzPOS Digital Menu v2). Pure:
// the greeting, a dish's badge, picking options, how far the guest's order
// has got, and the 360° view's degrees.

// "Good evening" by the phone's clock.
export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// The big line over the menu: food asks what they're craving (tonight
// after 5 pm), drinks offer something to sip.
export function headline(department: Department, hour: number): string {
  if (department === "BAR") return "Something to sip on?";
  if (hour < 12) return "What are you craving this morning?";
  if (hour < 17) return "What are you craving today?";
  return "What are you craving tonight?";
}

// A card's corner badge: 3D first, then 360°; none for a photo alone.
export function mediaBadge(item: { spin: boolean; model: boolean }): "3D" | "360°" | null {
  if (item.model) return "3D";
  if (item.spin) return "360°";
  return null;
}

type Group = { id: string; name: string; min: number; max: number; options: { id: string }[] };

// A tap on an option. One choice (max 1): picking another swaps it; tapping
// the one that's on takes it off unless the group needs one. Several: on or
// off, never past the group's most.
export function toggleOption(picked: readonly string[], group: Group, optionId: string): string[] {
  const mine = new Set(group.options.map((o) => o.id));
  if (!mine.has(optionId)) return [...picked];
  const on = picked.includes(optionId);
  if (group.max === 1) {
    if (on) return group.min >= 1 ? [...picked] : picked.filter((id) => id !== optionId);
    return [...picked.filter((id) => !mine.has(id)), optionId];
  }
  if (on) return picked.filter((id) => id !== optionId);
  if (picked.filter((id) => mine.has(id)).length >= group.max) return [...picked];
  return [...picked, optionId];
}

// The groups still short of their least, by name: the Add button asks for
// them ("Choose protein, spice level").
export function missingGroups(groups: readonly Group[], picked: readonly string[]): string[] {
  return groups.filter((g) => g.options.filter((o) => picked.includes(o.id)).length < g.min).map((g) => g.name);
}

// "+" on a card adds the dish straight away when nothing needs choosing.
export const addsStraightAway = (groups: readonly { min: number }[]) => groups.every((g) => g.min === 0);

// The order tracker: Waiting → Sent to kitchen → Preparing → Ready. The
// step is the one the slowest line still underway is at (-1: none is).
export const TRACK_STAGES = ["waiting", "sent", "preparing", "ready"] as const;
export function trackerStep(stages: readonly GuestStage[]): number {
  const steps = stages.map((s) => (TRACK_STAGES as readonly string[]).indexOf(s)).filter((i) => i >= 0);
  return steps.length ? Math.min(...steps) : -1;
}

// The 360° view's angle for a spin position (in frames), 0–359.
export function degreesAt(position: number, frames: number): number {
  if (frames <= 0) return 0;
  const turn = (((position % frames) + frames) % frames) / frames;
  return Math.round(turn * 360) % 360;
}
