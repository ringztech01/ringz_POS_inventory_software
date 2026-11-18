// Run with: npx tsx --test modules/restaurant/__tests__/showcaseMenu.test.ts
// The Showcase guest menu's rules (lib/showcaseMenu.ts): the greeting, a
// dish's badge, picking options, the order tracker and the 360° degrees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addsStraightAway, degreesAt, greeting, headline, mediaBadge, missingGroups, toggleOption, trackerStep } from "../lib/showcaseMenu";

test("the greeting follows the phone's clock", () => {
  assert.equal(greeting(0), "Good morning");
  assert.equal(greeting(11), "Good morning");
  assert.equal(greeting(12), "Good afternoon");
  assert.equal(greeting(16), "Good afternoon");
  assert.equal(greeting(17), "Good evening");
  assert.equal(greeting(23), "Good evening");
});

test("the headline: food by the time of day, drinks always the same", () => {
  assert.equal(headline("FOOD", 9), "What are you craving this morning?");
  assert.equal(headline("FOOD", 13), "What are you craving today?");
  assert.equal(headline("FOOD", 20), "What are you craving tonight?");
  assert.equal(headline("BAR", 9), "Something to sip on?");
  assert.equal(headline("BAR", 21), "Something to sip on?");
});

test("a card's badge: 3D over 360°, none for a photo alone", () => {
  assert.equal(mediaBadge({ spin: true, model: true }), "3D");
  assert.equal(mediaBadge({ spin: false, model: true }), "3D");
  assert.equal(mediaBadge({ spin: true, model: false }), "360°");
  assert.equal(mediaBadge({ spin: false, model: false }), null);
});

const protein = { id: "g1", name: "Protein", min: 1, max: 1, options: [{ id: "chicken" }, { id: "beef" }] };
const sauce = { id: "g2", name: "Sauce", min: 0, max: 1, options: [{ id: "pepper" }, { id: "ofada" }] };
const extras = { id: "g3", name: "Extras", min: 0, max: 2, options: [{ id: "plantain" }, { id: "moimoi" }, { id: "slaw" }] };

test("one choice: another swaps it; a required one stays on, an optional one comes off", () => {
  assert.deepEqual(toggleOption([], protein, "chicken"), ["chicken"]);
  assert.deepEqual(toggleOption(["chicken", "plantain"], protein, "beef"), ["plantain", "beef"]);
  assert.deepEqual(toggleOption(["chicken"], protein, "chicken"), ["chicken"]);
  assert.deepEqual(toggleOption(["pepper"], sauce, "pepper"), []);
  assert.deepEqual(toggleOption(["pepper"], sauce, "ofada"), ["ofada"]);
});

test("several: on and off, never past the most", () => {
  assert.deepEqual(toggleOption([], extras, "plantain"), ["plantain"]);
  assert.deepEqual(toggleOption(["plantain"], extras, "moimoi"), ["plantain", "moimoi"]);
  assert.deepEqual(toggleOption(["plantain", "moimoi"], extras, "slaw"), ["plantain", "moimoi"]);
  assert.deepEqual(toggleOption(["plantain", "moimoi", "chicken"], extras, "plantain"), ["moimoi", "chicken"]);
});

test("an option from another group changes nothing", () => {
  assert.deepEqual(toggleOption(["chicken"], extras, "beef"), ["chicken"]);
});

test("the groups still to choose, and whether + adds straight away", () => {
  assert.deepEqual(missingGroups([protein, sauce, extras], []), ["Protein"]);
  assert.deepEqual(missingGroups([protein, sauce, extras], ["beef"]), []);
  assert.deepEqual(missingGroups([{ ...extras, min: 2 }], ["slaw"]), ["Extras"]);
  assert.equal(addsStraightAway([sauce, extras]), true);
  assert.equal(addsStraightAway([protein, sauce]), false);
  assert.equal(addsStraightAway([]), true);
});

test("the tracker shows the slowest line still underway", () => {
  assert.equal(trackerStep([]), -1);
  assert.equal(trackerStep(["served", "cancelled", "rejected"]), -1);
  assert.equal(trackerStep(["waiting"]), 0);
  assert.equal(trackerStep(["preparing", "sent", "served"]), 1);
  assert.equal(trackerStep(["ready", "preparing"]), 2);
  assert.equal(trackerStep(["ready", "served"]), 3);
});

test("the 360° view's degrees wrap round the frames", () => {
  assert.equal(degreesAt(0, 36), 0);
  assert.equal(degreesAt(9, 36), 90);
  assert.equal(degreesAt(18, 36), 180);
  assert.equal(degreesAt(36, 36), 0);
  assert.equal(degreesAt(-9, 36), 270);
  assert.equal(degreesAt(4.5, 36), 45);
  assert.equal(degreesAt(35.99, 36), 0);
  assert.equal(degreesAt(5, 0), 0);
});
