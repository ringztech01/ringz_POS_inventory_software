import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import ExpenseCategoriesInteractive from "@/components/expense-categories/ExpenseCategoriesInteractive";
import { getExpenseCategoryList } from "./queries";

const DEFAULT_PER_PAGE = 10;
// Design: Records per page 10 / 25 / 50.
const PER_PAGE_OPTIONS = [10, 25, 50];

type ExpenseCategoryPageSearchParams = {
  q?: string;
  page?: string;
  perPage?: string;
};

// /expense-categories — server-fetched; search (?q=) and pagination
// (?page=&perPage=) run server-side.
export default async function ExpenseCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<ExpenseCategoryPageSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_EXPENSE_CATEGORIES);
  if (denied) return denied;

  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : DEFAULT_PER_PAGE;

  const { categories, total } = await getExpenseCategoryList({ q, page, perPage });
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <ExpenseCategoriesInteractive
      categories={categories}
      total={total}
      page={page}
      perPage={perPage}
      totalPages={totalPages}
      perPageOptions={PER_PAGE_OPTIONS}
    />
  );
}
