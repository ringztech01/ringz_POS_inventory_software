import { formatNaira } from "@/lib/format";

// Modifier rules, shared by the options pop-up (Add disabled until they're
// met) and the server (which re-checks and refuses a bad selection).

export type GroupRule = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  optionIds: readonly string[];
};

// "required", "optional", "up to 2", "pick 2", "pick 1–3".
export function groupRuleLabel(minSelect: number, maxSelect: number): string {
  if (minSelect === maxSelect) return minSelect === 1 ? "required" : `pick ${minSelect}`;
  if (minSelect === 0) return maxSelect === 1 ? "optional" : `up to ${maxSelect}`;
  return `pick ${minSelect}–${maxSelect}`;
}

// null when the chosen options suit the dish's groups; otherwise what's
// wrong, for the first group that isn't met.
export function checkSelection(groups: readonly GroupRule[], modifierIds: readonly string[]): string | null {
  if (new Set(modifierIds).size !== modifierIds.length) return "Pick each option once.";
  const known = new Set(groups.flatMap((g) => g.optionIds));
  if (modifierIds.some((id) => !known.has(id))) return "That option isn't available for this dish. Pick again.";
  for (const group of groups) {
    const picked = group.optionIds.filter((id) => modifierIds.includes(id)).length;
    if (picked < group.minSelect) {
      const need = group.minSelect === group.maxSelect ? (group.minSelect === 1 ? "one" : String(group.minSelect)) : `at least ${group.minSelect}`;
      return `${group.name}: pick ${need}.`;
    }
    if (picked > group.maxSelect) return `${group.name}: pick up to ${group.maxSelect}.`;
  }
  return null;
}

// Two New lines are the same dish order when they have the same options and
// note; the server also requires the same snapshot price before adding to
// an existing line instead of starting a new one.
export function mergeKey(modifierKeys: readonly string[], note: string | null): string {
  return JSON.stringify([[...modifierKeys].sort(), (note ?? "").trim()]);
}

export const NOTE_MAX = 140;
export const MAX_LINE_QUANTITY = 99;

// Food › Modifiers: a group's type and whether it's required (minimum ≥ 1).
export function groupType(maxSelect: number): "Single choice" | "Multiple choice" {
  return maxSelect === 1 ? "Single choice" : "Multiple choice";
}

export function isRequiredGroup(minSelect: number): boolean {
  return minSelect >= 1;
}

// A modifier's price change as the Food screens show it: "+₦2.00",
// "−₦1.00", or "No change".
export function priceChangeLabel(price: string): string {
  const value = Number(price);
  if (value === 0) return "No change";
  return `${value < 0 ? "−" : "+"}${formatNaira(price.replace(/^-/, ""))}`;
}
