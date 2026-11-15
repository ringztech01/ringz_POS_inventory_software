// Run with: npx tsx --test modules/restaurant/__tests__/reportsCode.test.ts
// Restaurant Reports, Step 12, read from the source: no `any` anywhere in
// the Reports code (its queries, pure logic, components, page, export and
// actions, and the shared export helper).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const inDir = (dir: string, match: RegExp) =>
  readdirSync(path.join(ROOT, dir))
    .filter((f) => match.test(f))
    .map((f) => `${dir}/${f}`);

test("no `any` in the Restaurant Reports code", () => {
  const files = [
    ...inDir("modules/restaurant/server/queries/reports", /\.ts$/),
    ...inDir("modules/restaurant/components/reports", /\.tsx?$/),
    ...inDir("modules/restaurant/lib", /^report.*\.ts$/),
    "modules/restaurant/lib/lineCost.ts",
    "modules/restaurant/pages/ReportsPage.tsx",
    "modules/restaurant/server/reportExport.ts",
    "modules/restaurant/server/reportExportRoute.ts",
    "modules/restaurant/server/actions/reports.ts",
    "modules/restaurant/server/actions/reportSettings.ts",
    "modules/restaurant/server/services/reportSettings.ts",
    "modules/restaurant/schemas/reports.ts",
    "modules/restaurant/components/settings/ReportSettingsForm.tsx",
    "lib/reports/exportXlsx.ts",
  ];
  assert.ok(files.length >= 40, `found ${files.length} files`);
  const offenders = files.filter((file) => /(:\s*any\b|\bas any\b|<any>|any\[\]|Array<any>)/.test(read(file)));
  assert.deepEqual(offenders, []);
});
