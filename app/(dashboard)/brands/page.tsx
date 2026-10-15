import { redirect } from "next/navigation";
import { auth } from "@/auth";
import BrandsInteractive from "@/components/brands/BrandsInteractive";
import { getBrandList } from "./queries";

const DEFAULT_PER_PAGE = 10;
const PER_PAGE_OPTIONS = [10, 25];

type BrandPageSearchParams = {
  q?: string;
  page?: string;
  perPage?: string;
};

export default async function BrandsPage({ searchParams }: { searchParams: Promise<BrandPageSearchParams> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : DEFAULT_PER_PAGE;

  const { brands, total } = await getBrandList({ q, page, perPage });
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return <BrandsInteractive brands={brands} total={total} page={page} perPage={perPage} totalPages={totalPages} />;
}
