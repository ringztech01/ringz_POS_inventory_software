import { Role } from "@prisma/client";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  CASHIER: "Cashier",
};

// Derived from the Prisma enum itself (the single source of truth already
// tied to the database column) rather than a separate hardcoded list, so a
// dropdown built from this always matches what the schema actually allows.
export const ROLE_OPTIONS: { value: Role; label: string }[] = Object.values(Role).map((value) => ({
  value,
  label: ROLE_LABELS[value],
}));
