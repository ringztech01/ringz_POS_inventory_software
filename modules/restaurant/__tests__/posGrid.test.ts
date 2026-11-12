// Run with: npx tsx --test modules/restaurant/__tests__/posGrid.test.ts
// The touch POS's menu pad (lib/posGrid.ts): departments, colours, and the
// fixed 6 × 5 grid that pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEPARTMENT_SHADES, departmentOf, GRID_SLOTS, gridPage, groupColor, pageCount } from "../lib/posGrid";

test("a dish's department: the Bar station, else its old prep station", () => {
  assert.equal(departmentOf("BAR", null), "BAR");
  assert.equal(departmentOf("bar", "KITCHEN"), "BAR");
  assert.equal(departmentOf("KIT", "BAR"), "FOOD", "the station wins over the old prep station");
  assert.equal(departmentOf("GRL", null), "FOOD");
  assert.equal(departmentOf(null, "BAR"), "BAR");
  assert.equal(departmentOf(null, null), "FOOD");
});

test("the grid is always 30 cells; buttons keep their place, pages fill in order", () => {
  assert.equal(GRID_SLOTS, 30);
  const seven = Array.from({ length: 7 }, (_, i) => `d${i}`);
  const page = gridPage(seven, 0);
  assert.equal(page.length, 30);
  assert.deepEqual(page.slice(0, 7), seven);
  assert.ok(page.slice(7).every((cell) => cell === null));

  const many = Array.from({ length: 65 }, (_, i) => i);
  assert.equal(pageCount(many.length), 3);
  assert.deepEqual(gridPage(many, 1).slice(0, 2), [30, 31]);
  assert.deepEqual(gridPage(many, 2).filter((c) => c !== null), [60, 61, 62, 63, 64]);
  // Past the end: the last page (a menu that shrank under an open page).
  assert.deepEqual(gridPage(many, 9), gridPage(many, 2));
  assert.equal(pageCount(0), 1);
  assert.equal(gridPage([], 0).length, 30);
});

test("group colours: the department's shades, in turn", () => {
  assert.equal(groupColor("FOOD", 0), DEPARTMENT_SHADES.FOOD[0]);
  assert.equal(groupColor("BAR", DEPARTMENT_SHADES.BAR.length + 1), DEPARTMENT_SHADES.BAR[1]);
  // Each shade carries white text at 4.5 : 1 or better.
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const shade of [...DEPARTMENT_SHADES.FOOD, ...DEPARTMENT_SHADES.BAR]) {
    assert.ok(1.05 / (luminance(shade) + 0.05) >= 4.5, shade);
  }
});
