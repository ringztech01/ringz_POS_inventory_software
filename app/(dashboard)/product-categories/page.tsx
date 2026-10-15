import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ProductCategoriesInteractive from "@/components/categories/ProductCategoriesInteractive";
import { getCategoryList } from "./queries";

const DEFAULT_PER_PAGE = 10;
const PER_PAGE_OPTIONS = [10, 25];

type CategoryPageSearchParams = {
  q?: string;
  page?: string;
  perPage?: string;
};

export default async function ProductCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<CategoryPageSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : DEFAULT_PER_PAGE;

  const { categories, total } = await getCategoryList({ q, page, perPage });
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <ProductCategoriesInteractive
      categories={categories}
      total={total}
      page={page}
      perPage={perPage}
      totalPages={totalPages}
    />
  );
}
