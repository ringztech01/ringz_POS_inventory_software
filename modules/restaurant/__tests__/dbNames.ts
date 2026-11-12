// Table numbers are unique across the business among live tables (the
// floor plan, Part 7 Step 1), and every DB test file runs in its own process
// on the same copy — so a test's table gets a suffix unique to this run:
// testTable("B3") → "B3-K7QF".
const RUN = Math.random().toString(36).slice(2, 6).toUpperCase();
export const testTable = (base: string) => `${base}-${RUN}`;
