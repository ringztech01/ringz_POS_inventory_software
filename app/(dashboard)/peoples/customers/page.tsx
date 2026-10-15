import { Suspense } from "react";
import { Plus } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrimaryButton from "@/components/ui/PrimaryButton";
import SearchInput from "@/components/ui/SearchInput";
import Pagination from "@/components/ui/Pagination";
import CustomerTable from "@/components/customers/CustomerTable";
import ImportCustomersButton from "@/components/customers/ImportCustomersButton";
import { getCustomerList } from "./queries";

const DEFAULT_PER_PAGE = 10;
const PER_PAGE_OPTIONS = [10, 25];

type CustomerPageSearchParams = {
  q?: string;
  page?: string;
  perPage?: string;
};

export default async function CustomerListPage({
  searchParams,
}: {
  searchParams: Promise<CustomerPageSearchParams>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : DEFAULT_PER_PAGE;

  const { customers, total } = await getCustomerList({ q, page, perPage });
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: FONTS.display,
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-.015em",
            }}
          >
            Customers
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            {total} customer{total === 1 ? "" : "s"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <ImportCustomersButton />
          <PrimaryButton href="/peoples/customers/create">
            <Plus size={14} strokeWidth={1.9} />
            Create Customer
          </PrimaryButton>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
        }}
      >
        <div style={{ padding: "18px 20px", borderBottom: `1px solid ${COLORS.border}`, borderRadius: "12px 12px 0 0" }}>
          <Suspense fallback={null}>
            <SearchInput />
          </Suspense>
        </div>

        <CustomerTable customers={customers} />

        <Suspense fallback={null}>
          <Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />
        </Suspense>
      </div>
    </div>
  );
}
