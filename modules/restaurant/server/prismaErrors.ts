import "server-only";
import { Prisma } from "@prisma/client";

// A unique index refused the write; `field` is in the index's name
// (Order_activeTableId_key → "activeTableId").
export function isUniqueViolation(error: unknown, field: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta?.target ?? "").includes(field)
  );
}
