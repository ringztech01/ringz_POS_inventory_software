import { redirect } from "next/navigation";
import { auth } from "@/auth";
import UnitsInteractive from "@/components/units/UnitsInteractive";
import { getUnitList } from "./queries";

const DEFAULT_PER_PAGE = 10;
const PER_PAGE_OPTIONS = [10, 25];

type UnitPageSearchParams = {
  q?: string;
  page?: string;
  perPage?: string;
};

export default async function UnitsPage({ searchParams }: { searchParams: Promise<UnitPageSearchParams> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : DEFAULT_PER_PAGE;

  const { units, total } = await getUnitList({ q, page, perPage });
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return <UnitsInteractive units={units} total={total} page={page} perPage={perPage} totalPages={totalPages} />;
}
