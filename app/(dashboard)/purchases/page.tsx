import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { auth } from "@/auth";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrimaryButton from "@/components/ui/PrimaryButton";
import SearchInput from "@/components/ui/SearchInput";
import Pagination from "@/components/ui/Pagination";
import PurchaseTable from "@/components/purchases/PurchaseTable";
import PurchaseFilters from "@/components/purchases/PurchaseFilters";
import { getActiveWarehouses, getPurchaseList } from "./queries";

const DEFAULT_PER_PAGE = 10;
const PER_PAGE_OPTIONS = [10, 25, 50];

type PurchasePageSearchParams = {
  q?: string;
  from?: string;
  to?: string;
  warehouse?: string;
  page?: string;
  perPage?: string;
};

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<PurchasePageSearchParams>;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : DEFAULT_PER_PAGE;

  const warehouses = await getActiveWarehouses();
  // Only filter by a warehouse id that actually exists (and isn't deleted).
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === params.warehouse) ?? null;

  const { purchases, total, grandTotalSum } = await getPurchaseList({
    q,
    from: params.from,
    to: params.to,
    warehouseId: selectedWarehouse?.id,
    page,
    perPage,
  });
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
            Purchases
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            {total} purchase order{total === 1 ? "" : "s"} ·{" "}
            {selectedWarehouse ? `${selectedWarehouse.name} warehouse` : "All warehouses"}
          </p>
        </div>
        <PrimaryButton href="/purchases/create">
          <Plus size={15} strokeWidth={2} />
          Create Purchase
        </PrimaryButton>
      </div>

      <div
        style={{
          background: "#fff",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(23,27,28,.06)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "18px 20px",
            borderBottom: `1px solid ${COLORS.border}`,
            borderRadius: "12px 12px 0 0",
            // Above the table so the Filters popover isn't covered by rows.
            position: "relative",
            zIndex: 2,
          }}
        >
          <Suspense fallback={null}>
            <SearchInput placeholder="Search" />
          </Suspense>
          <Suspense fallback={null}>
            <PurchaseFilters warehouses={warehouses} />
          </Suspense>
        </div>

        <PurchaseTable purchases={purchases} grandTotalSum={grandTotalSum} />

        <Suspense fallback={null}>
          <Pagination
            page={page}
            perPage={perPage}
            total={total}
            totalPages={totalPages}
            perPageOptions={PER_PAGE_OPTIONS}
          />
        </Suspense>
      </div>
    </div>
  );
}
