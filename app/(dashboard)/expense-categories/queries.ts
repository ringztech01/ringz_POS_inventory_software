import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type ExpenseCategoryListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

const EXPENSE_CATEGORY_SELECT = {
  id: true,
  name: true,
} satisfies Prisma.ExpenseCategorySelect;

export type PublicExpenseCategory = Prisma.ExpenseCategoryGetPayload<{ select: typeof EXPENSE_CATEGORY_SELECT }>;

// Active categories only; search (?q=) and pagination run here, server-side.
export async function getExpenseCategoryList({ q, page = 1, perPage = 10 }: ExpenseCategoryListParams) {
  const where: Prisma.ExpenseCategoryWhereInput = {
    deletedAt: null,
    ...(q ? { name: { contains: q } } : {}),
  };

  const [total, categories] = await Promise.all([
    prisma.expenseCategory.count({ where }),
    prisma.expenseCategory.findMany({
      where,
      select: EXPENSE_CATEGORY_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { categories, total };
}

// Select options for the expense form: active categories only.
export async function getActiveExpenseCategories() {
  return prisma.expenseCategory.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
