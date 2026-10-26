import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import ExpenseForm from "@/components/expenses/ExpenseForm";
import { getActiveWarehouses } from "../../purchases/queries";
import { getActiveExpenseCategories } from "../../expense-categories/queries";
import { createExpense } from "../actions";

// /expenses/create — the design's create view. Warehouses and categories
// come from their tables (active rows only), not the design's sample options.
export default async function CreateExpensePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_EXPENSES);
  if (denied) return denied;

  const [warehouses, categories] = await Promise.all([getActiveWarehouses(), getActiveExpenseCategories()]);

  return <ExpenseForm warehouses={warehouses} categories={categories} saveAction={createExpense} />;
}
