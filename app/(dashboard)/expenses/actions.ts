"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth/permissions.server";
import { generateReference } from "@/lib/reference";
import { expenseSchema, type ExpenseInput } from "@/lib/validations/expense";
import { isReferenceCollision, MAX_REFERENCE_ATTEMPTS } from "../purchases/document-actions";
import type { ExpenseActionState, ExpenseFieldName } from "./types";

const LIST_PATH = "/expenses";
const requireManageExpenses = () => requirePermission(PERMISSIONS.MANAGE_EXPENSES);

function invalid(fieldErrors: Partial<Record<ExpenseFieldName, string[]>>): ExpenseActionState {
  return { ok: false, error: "Please fix the errors below.", fieldErrors };
}

// zod → re-read the warehouse and category server-side (both must exist and
// not be soft-deleted) → the row's columns. Amount goes in as a
// Prisma.Decimal built from the validated string — never a float.
async function parseExpense(input: unknown) {
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "invalid" as const,
      state: invalid(parsed.error.flatten().fieldErrors as Partial<Record<ExpenseFieldName, string[]>>),
    };
  }
  const data: ExpenseInput = parsed.data;

  const [warehouse, category] = await Promise.all([
    prisma.warehouse.findFirst({ where: { id: data.warehouseId, deletedAt: null }, select: { id: true } }),
    prisma.expenseCategory.findFirst({ where: { id: data.expenseCategoryId, deletedAt: null }, select: { id: true } }),
  ]);
  const fieldErrors: Partial<Record<ExpenseFieldName, string[]>> = {};
  if (!warehouse) fieldErrors.warehouseId = ["Warehouse not found. Choose another one."];
  if (!category) fieldErrors.expenseCategoryId = ["Expense category not found. Choose another one."];
  if (!warehouse || !category) return { kind: "invalid" as const, state: invalid(fieldErrors) };

  return {
    kind: "ok" as const,
    row: {
      date: data.date,
      title: data.title,
      warehouseId: warehouse.id,
      expenseCategoryId: category.id,
      amount: new Prisma.Decimal(data.amount),
      details: data.details ?? null,
    },
  };
}

// A single-row write: no stock and no transaction. The only retry is for the
// random EX_ reference — the unique index on Expense.reference makes a
// (practically impossible) collision fail, and we try again with a new one.
export async function createExpense(input: unknown): Promise<ExpenseActionState> {
  const authCheck = await requireManageExpenses();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  const parsed = await parseExpense(input);
  if (parsed.kind === "invalid") return parsed.state;

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await prisma.expense.create({
        data: { ...parsed.row, reference: generateReference("EX"), createdById: authCheck.userId },
        select: { reference: true },
      });
      revalidatePath(LIST_PATH);
      return { ok: true, reference: created.reference };
    } catch (error) {
      if (isReferenceCollision(error) && attempt < MAX_REFERENCE_ATTEMPTS) continue;
      if (isReferenceCollision(error)) {
        return { ok: false, error: "Couldn't generate a unique reference number. Please try saving again." };
      }
      throw error;
    }
  }
}

// The reference is never regenerated on edit.
export async function updateExpense(id: string, input: unknown): Promise<ExpenseActionState> {
  const authCheck = await requireManageExpenses();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the expense server-side; only its id came from the client (and
  // the page binds it).
  const existing = await prisma.expense.findFirst({ where: { id, deletedAt: null }, select: { reference: true } });
  if (!existing) {
    return { ok: false, error: "Expense not found. It may have been deleted." };
  }

  const parsed = await parseExpense(input);
  if (parsed.kind === "invalid") return parsed.state;

  // Conditional on still being active (it could be deleted meanwhile).
  const { count } = await prisma.expense.updateMany({ where: { id, deletedAt: null }, data: parsed.row });
  if (count === 0) {
    return { ok: false, error: "Expense not found. It may have been deleted." };
  }

  revalidatePath(LIST_PATH);
  return { ok: true, reference: existing.reference };
}

// Soft delete — never a hard delete. An expense moves no stock, so there is
// nothing to reverse: it just stops being listed.
export async function deleteExpense(id: string): Promise<ExpenseActionState> {
  const authCheck = await requireManageExpenses();
  if (authCheck.error !== undefined) {
    return { ok: false, error: authCheck.error };
  }

  // Re-read the expense server-side; only its id came from the client. The
  // update is conditional on it still being active, so a double-click or a
  // concurrent delete reports "not found" instead of re-stamping deletedAt.
  const existing = await prisma.expense.findFirst({ where: { id, deletedAt: null }, select: { reference: true } });
  const { count } = existing
    ? await prisma.expense.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } })
    : { count: 0 };
  if (!existing || count === 0) {
    return { ok: false, error: "Expense not found. It may have already been deleted." };
  }

  revalidatePath(LIST_PATH);
  return { ok: true, reference: existing.reference };
}
