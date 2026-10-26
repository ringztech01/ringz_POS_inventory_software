import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import PurchaseListShell, { parseListParams, type PurchaseListSearchParams } from "@/components/purchases/PurchaseListShell";
import ExpenseTable from "@/components/expenses/ExpenseTable";
import { getExpenseList } from "./queries";
import { deleteExpense } from "./actions";

// /expenses — server-fetched; search (?q=) and pagination (?page=&perPage=)
// run server-side.
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<PurchaseListSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_EXPENSES);
  if (denied) return denied;

  const { q, page, perPage } = parseListParams(await searchParams, []);
  const { expenses, total } = await getExpenseList({ q, page, perPage });

  return (
    <PurchaseListShell
      title="Expenses"
      count={total}
      countNoun="expense"
      subtitle="recorded"
      createHref="/expenses/create"
      createLabel="Create Expense"
      page={page}
      perPage={perPage}
      showPageNumbers
      showFilters={false}
    >
      <ExpenseTable rows={expenses} deleteAction={deleteExpense} />
    </PurchaseListShell>
  );
}
