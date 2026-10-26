import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatDateForInput, formatDateTime } from "@/lib/format";
import type { ExpenseRow } from "@/components/expenses/ExpenseTable";
import type { ExpenseFormValues } from "./types";

export type ExpenseListParams = { q?: string; page?: number; perPage?: number };

// Active expenses only. Search (?q=) matches the reference, title, warehouse
// or category name; pagination runs here, server-side.
export async function getExpenseList({ q, page = 1, perPage = 10 }: ExpenseListParams) {
  const where: Prisma.ExpenseWhereInput = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { reference: { contains: q } },
            { title: { contains: q } },
            { warehouse: { name: { contains: q } } },
            { expenseCategory: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      select: {
        id: true,
        reference: true,
        title: true,
        amount: true,
        createdAt: true,
        warehouse: { select: { name: true } },
        expenseCategory: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  // Decimal → string, and the created date formatted here: rows go to a
  // client component, and formatting on the server keeps the browser's
  // timezone from changing the text (hydration mismatch).
  const expenses: ExpenseRow[] = rows.map((row) => {
    const created = formatDateTime(row.createdAt);
    return {
      id: row.id,
      reference: row.reference,
      title: row.title,
      warehouseName: row.warehouse.name,
      categoryName: row.expenseCategory.name,
      amount: row.amount.toFixed(2),
      createdDate: created.date,
      createdTime: created.time,
    };
  });

  return { expenses, total };
}

// Pre-fill for /expenses/[id]/edit. Null for missing or soft-deleted
// expenses. A warehouse or category that has since been soft-deleted is left
// unselected ("") — saving requires an active one, so the user re-picks it.
export async function getExpenseForEdit(id: string): Promise<{ id: string; reference: string; initial: ExpenseFormValues } | null> {
  const expense = await prisma.expense.findFirst({
    where: { id, deletedAt: null },
    include: {
      warehouse: { select: { deletedAt: true } },
      expenseCategory: { select: { deletedAt: true } },
    },
  });
  if (!expense) return null;

  return {
    id: expense.id,
    reference: expense.reference,
    initial: {
      // Date-only values are stored at UTC midnight.
      date: formatDateForInput(expense.date),
      title: expense.title,
      warehouseId: expense.warehouse.deletedAt ? "" : expense.warehouseId,
      expenseCategoryId: expense.expenseCategory.deletedAt ? "" : expense.expenseCategoryId,
      // Decimal → string (never a float).
      amount: expense.amount.toFixed(2),
      details: expense.details ?? "",
    },
  };
}
