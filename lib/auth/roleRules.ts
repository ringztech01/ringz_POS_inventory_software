// Who may give someone a role (Part 6f): only an Administrator assigns the
// Administrator role — always, retail too — and, with the restaurant module
// on, a back-office role. Keeping someone's current role isn't granting it.
// Null: allowed.
export type AssignableRole = { isSystem: boolean; accessLevel: "SERVICE" | "BACK_OFFICE" };

export function assignRoleProblem(actor: { isAdmin: boolean }, role: AssignableRole, restaurantOn: boolean): string | null {
  if (actor.isAdmin) return null;
  if (role.isSystem) return "Only an Administrator can give someone the Administrator role.";
  if (restaurantOn && role.accessLevel === "BACK_OFFICE") return "Only an Administrator can give someone back-office access.";
  return null;
}

// Moving someone off a role: only an Administrator moves an Administrator.
export function unassignRoleProblem(actor: { isAdmin: boolean }, current: { isSystem: boolean } | null): string | null {
  if (actor.isAdmin || !current?.isSystem) return null;
  return "Only an Administrator can change an Administrator's role.";
}
