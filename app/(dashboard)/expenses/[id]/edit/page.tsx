import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import ExpenseForm from "@/components/expenses/ExpenseForm";
import { getActiveWarehouses } from "../../../purchases/queries";
import { getActiveExpenseCategories } from "../../../expense-categories/queries";
import { getExpenseForEdit } from "../../queries";
import { updateExpense } from "../../actions";

// /expenses/[id]/edit — the create form, pre-filled, with the reference shown
// read-only. The record is re-read server-side; missing or soft-deleted → 404.
export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_EXPENSES);
  if (denied) return denied;

  const { id } = await params;
  const [expense, warehouses, categories] = await Promise.all([
    getExpenseForEdit(id),
    getActiveWarehouses(),
    getActiveExpenseCategories(),
  ]);

  if (!expense) {
    notFound();
  }

  return (
    <ExpenseForm
      mode="edit"
      warehouses={warehouses}
      categories={categories}
      initial={expense.initial}
      reference={expense.reference}
      // Bound server action: the id is fixed here, never taken from the form.
      saveAction={updateExpense.bind(null, expense.id)}
    />
  );
}
