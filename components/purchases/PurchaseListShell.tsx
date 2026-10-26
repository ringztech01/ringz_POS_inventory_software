import { Suspense, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrimaryButton from "@/components/ui/PrimaryButton";
import SearchInput from "@/components/ui/SearchInput";
import Pagination from "@/components/ui/Pagination";
import PurchaseFilters from "./PurchaseFilters";
import type { FormOption } from "@/app/(dashboard)/purchases/types";

export const PER_PAGE_OPTIONS = [10, 25, 50];
const DEFAULT_PER_PAGE = 10;

export type PurchaseListSearchParams = {
  q?: string;
  from?: string;
  to?: string;
  warehouse?: string;
  page?: string;
  perPage?: string;
};

// Normalises a purchase document list's searchParams. The warehouse filter
// only applies when its id is one of the active warehouses.
export function parseListParams(
  params: PurchaseListSearchParams,
  warehouses: FormOption[],
  perPageOptions: number[] = PER_PAGE_OPTIONS,
) {
  return {
    q: params.q?.trim() || "",
    from: params.from,
    to: params.to,
    page: Math.max(1, Number(params.page) || 1),
    perPage: perPageOptions.includes(Number(params.perPage)) ? Number(params.perPage) : DEFAULT_PER_PAGE,
    selectedWarehouse: warehouses.find((warehouse) => warehouse.id === params.warehouse) ?? null,
  };
}

// Page chrome shared by the purchase/sale document lists (Purchases, Purchase
// Returns, Sales): header with count + Create button, search/filters toolbar, the
// table (children) and pagination.
export default function PurchaseListShell({
  title,
  count,
  countNoun,
  subtitle,
  selectedWarehouse,
  createHref,
  createLabel,
  warehouses,
  page,
  perPage,
  showPageNumbers,
  showFilters = true,
  perPageOptions = PER_PAGE_OPTIONS,
  children,
}: {
  title: string;
  count: number;
  // Singular, e.g. "purchase order" → "3 purchase orders".
  countNoun: string;
  // Replaces the "· All warehouses" suffix (Transfers: "between warehouses").
  subtitle?: string;
  selectedWarehouse?: FormOption | null;
  // Omit for lists without a Create button (Sale Returns start from a sale).
  createHref?: string;
  createLabel?: string;
  // Omit for a date-only Filters panel.
  warehouses?: FormOption[];
  page: number;
  perPage: number;
  showPageNumbers?: boolean;
  // false: search only, no Filters button (Expenses design).
  showFilters?: boolean;
  // Records-per-page choices (Roles design: 10 / 25).
  perPageOptions?: number[];
  children: ReactNode;
}) {
  const totalPages = Math.max(1, Math.ceil(count / perPage));

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
            {title}
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            {count} {countNoun}
            {count === 1 ? "" : "s"}{" "}
            {subtitle ?? `· ${selectedWarehouse ? `${selectedWarehouse.name} warehouse` : "All warehouses"}`}
          </p>
        </div>
        {createHref && (
          <PrimaryButton href={createHref}>
            <Plus size={15} strokeWidth={2} />
            {createLabel}
          </PrimaryButton>
        )}
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
          {showFilters && (
            <Suspense fallback={null}>
              <PurchaseFilters warehouses={warehouses} />
            </Suspense>
          )}
        </div>

        {children}

        <Suspense fallback={null}>
          <Pagination
            page={page}
            perPage={perPage}
            total={count}
            totalPages={totalPages}
            perPageOptions={perPageOptions}
            showPageNumbers={showPageNumbers}
          />
        </Suspense>
      </div>
    </div>
  );
}
