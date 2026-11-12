// Run with: npx tsx --test modules/restaurant/__tests__/posTheme.test.ts
// The touch POS's two themes (lib/theme.ts): every pairing used on screen
// reads (4.5 : 1 or better), and the variables cover every themed colour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOUCH, TOUCH_THEMES, touchThemeVars } from "../lib/theme";

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

test("both themes read: text on the frame and header, white on keys, quiet text on idle keys", () => {
  for (const [name, t] of Object.entries(TOUCH_THEMES)) {
    const pairs: [string, string, string][] = [
      ["text on frame", t.text, t.frame],
      ["text on header", t.text, t.header],
      ["dim text on frame", t.textDim, t.frame],
      ["white on key", "#FFFFFF", t.key],
      ["white on raised", "#FFFFFF", t.raised],
      ["quiet text on raised", t.onRaised, t.raised],
      ["white on a pressed key", "#FFFFFF", t.keyDown],
      ["Cancel's text on Cancel", t.dangerText, t.cancel],
    ];
    for (const [what, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${what} ${contrast(fg, bg).toFixed(2)}`);
  }
});

test("the variables: one per themed colour; TOUCH falls back to the dark theme", () => {
  assert.deepEqual(Object.keys(touchThemeVars(true)).sort(), Object.keys(TOUCH_THEMES.light).map((k) => `--t-${k}`).sort());
  assert.equal(touchThemeVars(false)["--t-frame"], "#1E2228");
  assert.equal(touchThemeVars(true)["--t-frame"], TOUCH_THEMES.light.frame);
  assert.equal(TOUCH.frame, "var(--t-frame, #1E2228)");
  // The Restaurant POS design: 4 px corners, 6 px between keys, its greys.
  assert.equal(TOUCH.radius, 4);
  assert.equal(TOUCH.gap, 6);
  assert.deepEqual([TOUCH_THEMES.dark.header, TOUCH_THEMES.dark.key, TOUCH_THEMES.dark.keyDown, TOUCH_THEMES.dark.empty], ["#15181C", "#2B3139", "#3A424C", "#252A31"]);
});
