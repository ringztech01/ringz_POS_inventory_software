// Run with: npx tsx --test lib/validations/role.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { roleSchema } from "./role";
import { ALL_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";

const issues = (input: unknown) => {
  const r = roleSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("roleSchema", () => {
  test("trims the name; keeps the chosen permissions", () => {
    const r = roleSchema.safeParse({ name: "  Store Keeper  ", permissions: [PERMISSIONS.MANAGE_PRODUCTS, PERMISSIONS.MANAGE_SALE] });
    assert.ok(r.success);
    assert.equal(r.data.name, "Store Keeper");
    assert.deepEqual(r.data.permissions, ["Manage Products", "Manage Sale"]);
  });

  test("name is required and at most 191 characters", () => {
    assert.deepEqual(issues({ name: "   ", permissions: [] }), ["name: Name is required."]);
    assert.deepEqual(issues({ permissions: [] }), ["name: Name is required."]);
    assert.deepEqual(issues({ name: "a".repeat(192), permissions: [] }), ["name: Name can be at most 191 characters."]);
  });

  test("permissions must be canonical strings", () => {
    assert.deepEqual(issues({ name: "X", permissions: ["manage_products"] }), ["permissions.0: Unknown permission."]);
    assert.deepEqual(issues({ name: "X", permissions: ["All Permissions"] }), ["permissions.0: Unknown permission."]);
    assert.deepEqual(issues({ name: "X", permissions: "Manage Products" }), ["permissions: Choose permissions."]);
  });

  test("duplicates collapse; an empty set is allowed; all 27 are accepted", () => {
    const dup = roleSchema.parse({ name: "X", permissions: ["Manage Sale", "Manage Sale", "Manage Units"] });
    assert.deepEqual(dup.permissions, ["Manage Sale", "Manage Units"]);
    assert.deepEqual(roleSchema.parse({ name: "X", permissions: [] }).permissions, []);
    assert.equal(roleSchema.parse({ name: "X", permissions: ALL_PERMISSIONS }).permissions.length, 27);
  });
});
