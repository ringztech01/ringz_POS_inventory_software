// Run with: npx tsx --test modules/restaurant/__tests__/optionFlow.test.ts
// The touch POS's options panel and Note keypad (lib/optionFlow.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTE_MAX } from "../lib/modifiers";
import {
  DEFAULT_QUICK_NOTES,
  needsOptions,
  optionLabel,
  optionNames,
  optionSteps,
  readQuickNotes,
  shortPrice,
  stepHint,
  stepReady,
  toggleOption,
  toggleQuickNote,
  typeKey,
  type FlowGroup,
} from "../lib/optionFlow";

const G = (id: string, minSelect: number, maxSelect: number, options: string[]): FlowGroup => ({ id, name: id, minSelect, maxSelect, options: options.map((o) => ({ id: o, name: o.toUpperCase(), price: "" })) });
const portion = G("Portion", 1, 1, ["reg", "large"]);
const protein = G("Protein", 1, 1, ["beef", "chicken"]);
const extras = G("Extras", 0, 2, ["plantain", "slaw", "moimoi"]);
const sauce = G("Sauce", 0, 1, ["pepper", "gravy"]);
const sides = G("Sides", 2, 3, ["a", "b", "c", "d"]);

test("steps: required groups in order, then one Extras step with every optional group", () => {
  const steps = optionSteps([extras, portion, sauce, protein]);
  assert.deepEqual(steps.map((s) => (s.kind === "pick" ? s.group.id : s.groups.map((g) => g.id).join("+"))), ["Portion", "Protein", "Extras+Sauce"]);
  assert.equal(optionSteps([portion]).length, 1);
  assert.deepEqual(optionSteps([extras]).map((s) => s.kind), ["extras"]);
  assert.equal(needsOptions([extras, sauce]), false, "optional only: the tap adds it plain");
  assert.equal(needsOptions([extras, portion]), true);
});

test("taps: one choice replaces; several toggle up to the limit; the step is ready at its minimum", () => {
  let s = toggleOption([], portion, "reg");
  s = toggleOption(s, portion, "large");
  assert.deepEqual(s, ["large"]);
  s = toggleOption(s, extras, "plantain");
  s = toggleOption(s, extras, "slaw");
  s = toggleOption(s, extras, "moimoi");
  assert.deepEqual(s, ["large", "plantain", "slaw"], "Extras stops at 2");
  assert.deepEqual(toggleOption(s, extras, "slaw"), ["large", "plantain"], "a second tap takes it off");
  const step = { kind: "pick" as const, group: sides };
  assert.equal(stepReady(step, ["a"]), false);
  assert.equal(stepReady(step, ["a", "b"]), true);
  assert.equal(stepReady({ kind: "extras", groups: [extras] }, []), true);
  assert.deepEqual(optionNames([portion, extras], ["slaw", "large"]), ["LARGE", "SLAW"]);
  // With a price, it's on the check too (the design's "Goat meat +₦1,000").
  const protein = { ...G("Protein", 1, 1, ["goat"]), options: [{ id: "goat", name: "Goat meat", price: "+₦1,000.00" }] };
  assert.deepEqual(optionNames([protein], ["goat"]), ["Goat meat +₦1,000"]);
  assert.equal(optionLabel("Pounded yam", ""), "Pounded yam");
});

test("hints and prices on the buttons", () => {
  assert.deepEqual([stepHint(portion), stepHint(sides), stepHint(G("Two", 2, 2, [])), stepHint(extras), stepHint(sauce)], ["pick one", "pick 2 to 3", "pick 2", "optional, up to 2", "optional"]);
  assert.deepEqual([shortPrice("+₦500.00"), shortPrice("+₦1,500.50"), shortPrice("")], ["+₦500", "+₦1,500.50", ""]);
});

test("quick notes: the saved list or the defaults; a tap puts one on or takes it off", () => {
  assert.deepEqual(readQuickNotes(null), DEFAULT_QUICK_NOTES);
  assert.deepEqual(readQuickNotes([" No salt ", "", 3, "Well done"]), ["No salt", "Well done"]);
  assert.deepEqual(readQuickNotes([]), []);
  let note = toggleQuickNote("", "No onion");
  note = toggleQuickNote(note, "Well done");
  assert.equal(note, "No onion, Well done");
  assert.equal(toggleQuickNote(note, "no onion"), "Well done");
  assert.equal(toggleQuickNote("x".repeat(NOTE_MAX - 3), "Well done"), "x".repeat(NOTE_MAX - 3), "never past the limit");
});

test("the on-screen keyboard: capitals at the start of a part, no double spaces, the limit", () => {
  let note = "";
  for (const key of ["s", "o", "f", "t", " ", " ", "y", "o"]) note = typeKey(note, key);
  assert.equal(note, "Soft yo");
  assert.equal(typeKey("No onion, ", "w"), "No onion, W");
  assert.equal(typeKey("", " "), "");
  assert.equal(typeKey("x".repeat(NOTE_MAX), "a").length, NOTE_MAX);
  // A desk keyboard's capitals stay; a name capitalises every word.
  assert.equal(typeKey("Ask for ", "J"), "Ask for J");
  assert.equal(["a", "d", "a", " ", "o", "k", "a", "f", "o", "r"].reduce((v, k) => typeKey(v, k, { words: true }), ""), "Ada Okafor");
});

test("the quick notes list as saved: trimmed, each once, short, at most 12", async () => {
  const { quickNotesSchema } = await import("../schemas/menuGroup");
  assert.deepEqual(quickNotesSchema.parse([" No salt ", "Well done"]), ["No salt", "Well done"]);
  assert.equal(quickNotesSchema.safeParse(["No salt", "no SALT"]).error?.issues[0]?.message, "Each quick note only once.");
  assert.equal(quickNotesSchema.safeParse(["x".repeat(31)]).error?.issues[0]?.message, "A quick note can be at most 30 characters.");
  assert.equal(quickNotesSchema.safeParse(["  "]).error?.issues[0]?.message, "A quick note can't be empty.");
  assert.equal(quickNotesSchema.safeParse(Array.from({ length: 13 }, (_, i) => `n${i}`)).error?.issues[0]?.message, "At most 12 quick notes.");
  assert.deepEqual(quickNotesSchema.parse([]), []);
});
