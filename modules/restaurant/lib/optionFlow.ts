import { NOTE_MAX } from "./modifiers";

// The touch POS's options panel (Part 6e Step 3): a dish's option groups as
// steps — the required ones in order (Portion → Protein → Spice level), then
// one last step with every optional group (Skip lit). Pure.

export type FlowOption = { id: string; name: string; price: string };
export type FlowGroup = { id: string; name: string; minSelect: number; maxSelect: number; options: FlowOption[] };
export type FlowStep = { kind: "pick"; group: FlowGroup } | { kind: "extras"; groups: FlowGroup[] };

export function optionSteps(groups: readonly FlowGroup[]): FlowStep[] {
  const optional = groups.filter((g) => g.minSelect < 1);
  return [...groups.filter((g) => g.minSelect >= 1).map((group): FlowStep => ({ kind: "pick", group })), ...(optional.length ? [{ kind: "extras" as const, groups: optional }] : [])];
}

// A tap on a dish opens the panel only when it has a required group; with
// optional groups only, the tap adds it plain (a long press opens Extras).
export const needsOptions = (groups: readonly FlowGroup[]) => groups.some((g) => g.minSelect >= 1);

// One choice (pick exactly one): a tap picks it and moves on.
export const isSingleChoice = (group: FlowGroup) => group.maxSelect === 1;

// A tap on an option: one choice — it replaces the group's pick; several —
// on/off, up to the group's limit.
export function toggleOption(selected: readonly string[], group: FlowGroup, optionId: string): string[] {
  const inGroup = selected.filter((id) => group.options.some((o) => o.id === id));
  if (isSingleChoice(group)) return [...selected.filter((id) => !inGroup.includes(id)), optionId];
  if (selected.includes(optionId)) return selected.filter((id) => id !== optionId);
  return inGroup.length >= group.maxSelect ? [...selected] : [...selected, optionId];
}

export const pickedIn = (selected: readonly string[], group: FlowGroup) => selected.filter((id) => group.options.some((o) => o.id === id)).length;

// The step's rule is met (Extras always is: everything there is optional).
export function stepReady(step: FlowStep, selected: readonly string[]): boolean {
  if (step.kind === "extras") return true;
  const picked = pickedIn(selected, step.group);
  return picked >= step.group.minSelect && picked <= step.group.maxSelect;
}

// "Portion · pick one", "Extras · up to 3", "Sides · pick 2".
export function stepHint(group: FlowGroup): string {
  if (group.minSelect < 1) return group.maxSelect === 1 ? "optional" : `optional, up to ${group.maxSelect}`;
  if (group.maxSelect === 1) return "pick one";
  return group.minSelect === group.maxSelect ? `pick ${group.minSelect}` : `pick ${group.minSelect} to ${group.maxSelect}`;
}

// "+₦500.00" → "+₦500" on a button (kobo kept when there are any).
export const shortPrice = (price: string) => price.replace(/\.00$/, "");

// An option on the check: its name, and its price when it has one
// ("Goat meat +₦1,000", "Pounded yam").
export const optionLabel = (name: string, price: string) => (price ? `${name} ${shortPrice(price)}` : name);

// The chosen options, in the dish's group order, as the check shows them.
export function optionNames(groups: readonly FlowGroup[], selected: readonly string[]): string[] {
  return groups.flatMap((g) => g.options.filter((o) => selected.includes(o.id)).map((o) => optionLabel(o.name, o.price)));
}

// ---- Quick notes (the Note keypad).

export const DEFAULT_QUICK_NOTES = ["No onion", "No pepper", "Extra spicy", "Well done", "No ice", "Allergy"];
export const QUICK_NOTE_MAX = 30;
export const MAX_QUICK_NOTES = 12;

// The saved list (JSON), or the default list when none is saved.
export function readQuickNotes(json: unknown): string[] {
  if (!Array.isArray(json)) return DEFAULT_QUICK_NOTES;
  return json.filter((n): n is string => typeof n === "string" && n.trim().length > 0).map((n) => n.trim().slice(0, QUICK_NOTE_MAX)).slice(0, MAX_QUICK_NOTES);
}

const parts = (note: string) => note.split(",").map((p) => p.trim()).filter(Boolean);

export const hasQuickNote = (note: string, phrase: string) => parts(note).some((p) => p.toLowerCase() === phrase.toLowerCase());

// A quick note on/off in the note ("No onion, Well done"); never past NOTE_MAX.
export function toggleQuickNote(note: string, phrase: string): string {
  const list = parts(note);
  const next = hasQuickNote(note, phrase) ? list.filter((p) => p.toLowerCase() !== phrase.toLowerCase()) : [...list, phrase];
  const joined = next.join(", ");
  return joined.length > NOTE_MAX ? note : joined;
}

// A key from the on-screen keyboard (lower case) or a desk keyboard: a
// letter starts in a capital at the start or a new part ("…, W") — and with
// `words` (a name), every word; a capital typed on a desk keyboard stays.
export function typeKey(note: string, key: string, { words = false }: { words?: boolean } = {}): string {
  if (note.length >= NOTE_MAX) return note;
  if (key === " " && (note === "" || note.endsWith(" "))) return note;
  const fresh = note.trim() === "" || /[,.]\s*$/.test(note) || (words && note.endsWith(" "));
  const char = /^[a-z]$/.test(key) && fresh ? key.toUpperCase() : key;
  return note + char;
}
