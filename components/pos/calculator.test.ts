// Run with: npx tsx --test components/pos/calculator.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatDisplay, INITIAL, keyFromKeyboard, press, type CalcState } from "./calculator";

// Type a sequence like "12+3=" (keyboard keys) and return the state.
function run(keys: string[], from: CalcState = INITIAL): CalcState {
  return keys.reduce((state, key) => {
    const mapped = keyFromKeyboard(key);
    assert.ok(mapped, `unmapped key ${key}`);
    return press(state, mapped);
  }, from);
}
const typed = (sequence: string) => run(sequence.split(""));

describe("arithmetic", () => {
  test("the four operations", () => {
    assert.equal(typed("12+30=").display, "42");
    assert.equal(typed("50-8=").display, "42");
    assert.equal(typed("6*7=").display, "42");
    assert.equal(typed("84/2=").display, "42");
  });

  test("exact decimals (no float error)", () => {
    assert.equal(typed("0.1+0.2=").display, "0.3");
    assert.equal(typed("1.1*3=").display, "3.3");
    assert.equal(typed("10/3=").display, "3.3333333333");
  });

  test("left to right, like a desk calculator", () => {
    const chain = typed("2+3*4");
    assert.equal(chain.display, "4");
    assert.equal(chain.stored, "5");
    assert.equal(run(["="], chain).display, "20");
  });

  test("a second operator replaces the first", () => {
    assert.equal(typed("9+-3=").display, "6");
  });

  test("negative results and continuing from a result", () => {
    assert.equal(typed("3-10=").display, "-7");
    assert.equal(typed("3-10=+2=").display, "-5");
  });

  test("percent", () => {
    assert.equal(typed("250%").display, "2.5");
    assert.equal(typed("200*15%=").display, "30");
  });
});

describe("editing", () => {
  test("one dot only; leading dot becomes 0.", () => {
    assert.equal(typed("1.2.3").display, "1.23");
    assert.equal(typed(".5").display, "0.5");
  });

  test("backspace, down to 0", () => {
    assert.equal(run(["1", "2", "3", "Backspace"]).display, "12");
    assert.equal(run(["7", "Backspace", "Backspace"]).display, "0");
  });

  test("a result starts fresh: the next digit replaces it", () => {
    assert.equal(typed("2+2=5").display, "5");
  });

  test("at most 15 digits", () => {
    assert.equal(typed("1234567890123456789").display, "123456789012345");
  });

  test("C clears everything", () => {
    assert.deepEqual(run(["5", "+", "3", "c"]), INITIAL);
  });
});

describe("divide by zero", () => {
  test("shows Error; operators are ignored until a digit or C", () => {
    const error = typed("5/0=");
    assert.equal(error.display, "Error");
    assert.equal(run(["+"], error).display, "Error");
    assert.equal(run(["7"], error).display, "7");
    assert.deepEqual(run(["c"], error), INITIAL);
  });
});

test("display formatting", () => {
  assert.equal(formatDisplay("1234567.5"), "1,234,567.5");
  assert.equal(formatDisplay("-1000"), "-1,000");
  assert.equal(formatDisplay("12."), "12.");
  assert.equal(formatDisplay("999"), "999");
});
