"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/permissions.server";
import { expenseCategorySchema } from "@/lib/validations/expense-category";
import type { ExpenseCategoryActionState } from "./types";

const LIST_PATH = "/expense-categories";

// Permission check (lib/auth/permissions.server.ts): DB-backed, per request.
const requireManageExpenseCategories = () => requirePermission(PERMISSIONS.MANAGE_EXPENSE_CATEGORIES);

function parseName(formData: FormData) {
  return expenseCategorySchema.safeParse({ name: formData.get("name") ?? "" });
}

// Another ACTIVE category with this name? (The column's collation makes the
// comparison case-insensitive, so "Rent" and "rent" clash.) `exceptId` skips
// the category being edited.
async function nameTaken(name: string, exceptId?: string) {
  const clash = await prisma.expenseCategory.findFirst({
    where: { name, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return !!clash;
}

const duplicate = (): ExpenseCategoryActionState => ({
  ok: false,
  error: "Please fix the errors below.",
  fieldErrors: { name: ["An expense category with this name already exists."] },
});

export async function createExpenseCategory(formData: FormData): Promise<ExpenseCategoryActionState> {
  const authCheck = await requireManageExpenseCategories();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  const parsed = parseName(formData);
  if (!parsed.success) {
    return { ok: false, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  if (await nameTaken(parsed.data.name)) {
    return duplicate();
  }

  await prisma.expenseCategory.create({ data: { name: parsed.data.name } });

  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function updateExpenseCategory(id: string, formData: FormData): Promise<ExpenseCategoryActionState> {
  const authCheck = await requireManageExpenseCategories();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the record server-side; missing or soft-deleted can't be edited.
  const existing = await prisma.expenseCategory.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!existing) {
    return { ok: false, error: "Expense category not found. It may have been deleted." };
  }

  const parsed = parseName(formData);
  if (!parsed.success) {
    return { ok: false, error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  if (await nameTaken(parsed.data.name, id)) {
    return duplicate();
  }

  // Conditional on still being active (it could be deleted meanwhile).
  const { count } = await prisma.expenseCategory.updateMany({
    where: { id, deletedAt: null },
    data: { name: parsed.data.name },
  });
  if (count === 0) {
    return { ok: false, error: "Expense category not found. It may have been deleted." };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}

// Soft delete — never a hard delete. Refused while any ACTIVE expense still
// uses the category (they'd point at a deleted category); reassign them
// first.
export async function deleteExpenseCategory(id: string): Promise<ExpenseCategoryActionState> {
  const authCheck = await requireManageExpenseCategories();
  if (authCheck.error) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the record server-side; only its id came from the client.
  const existing = await prisma.expenseCategory.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!existing) {
    return { ok: false, error: "Expense category not found. It may have already been deleted." };
  }

  const inUse = await prisma.expense.count({ where: { expenseCategoryId: id, deletedAt: null } });
  if (inUse > 0) {
    return {
      ok: false,
      error: `Can't delete — ${inUse} ${inUse === 1 ? "expense uses" : "expenses use"} this category. Reassign them first.`,
    };
  }

  // Conditional on still being active, so a double-click / concurrent delete
  // reports "not found" instead of re-stamping deletedAt.
  const { count } = await prisma.expenseCategory.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (count === 0) {
    return { ok: false, error: "Expense category not found. It may have already been deleted." };
  }

  revalidatePath(LIST_PATH);
  return { ok: true };
}
