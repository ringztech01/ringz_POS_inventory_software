import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Filter } from "lucide-react";
import { auth } from "@/auth";
import { COLORS, FONTS } from "@/components/layout/theme";
import PrimaryButton from "@/components/ui/PrimaryButton";
import SearchInput from "@/components/ui/SearchInput";
import Pagination from "@/components/ui/Pagination";
import ProductTable from "@/components/products/ProductTable";
import { getProductList } from "./queries";

const DEFAULT_PER_PAGE = 10;
const PER_PAGE_OPTIONS = [10, 25];

type ProductPageSearchParams = {
  q?: string;
  page?: string;
  perPage?: string;
};

export default async function ProductsPage({ searchParams }: { searchParams: Promise<ProductPageSearchParams> }) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const params = await searchParams;
  const q = params.q?.trim() || "";
  const page = Math.max(1, Number(params.page) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : DEFAULT_PER_PAGE;

  const { products, total } = await getProductList({ q, page, perPage });
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
            Products
          </h1>
          <p style={{ margin: 0, fontSize: 13.5, color: COLORS.slateMid }}>
            {total} product{total === 1 ? "" : "s"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            style={{
              height: 40,
              padding: "0 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#fff",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              fontSize: 13.5,
              fontWeight: 600,
              color: COLORS.text,
              cursor: "pointer",
            }}
          >
            <Filter size={14} strokeWidth={1.6} />
            Filters
          </button>
          <button
            type="button"
            style={{
              height: 40,
              padding: "0 16px",
              background: COLORS.tealTint,
              border: `1px solid ${COLORS.focusRing}`,
              borderRadius: 8,
              fontSize: 13.5,
              fontWeight: 600,
              color: COLORS.tealDark,
              cursor: "pointer",
            }}
          >
            Export Products
          </button>
          <button
            type="button"
            style={{
              height: 40,
              padding: "0 16px",
              background: "#fff",
              border: `1px solid ${COLORS.borderStrong}`,
              borderRadius: 8,
              fontSize: 13.5,
              fontWeight: 600,
              color: COLORS.text,
              cursor: "pointer",
            }}
          >
            Import Products
          </button>
          <PrimaryButton href="/products/create">Create Product</PrimaryButton>
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "18px 20px",
            borderBottom: `1px solid ${COLORS.border}`,
            borderRadius: "12px 12px 0 0",
          }}
        >
          <Suspense fallback={null}>
            <SearchInput />
          </Suspense>
          <div style={{ display: "flex", gap: 8, background: COLORS.bgApp, padding: 4, borderRadius: 8 }}>
            <button
              type="button"
              style={{
                height: 30,
                padding: "0 14px",
                border: "none",
                borderRadius: 6,
                background: "#fff",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(23,27,28,.06)",
              }}
            >
              All
            </button>
            <button
              type="button"
              style={{
                height: 30,
                padding: "0 14px",
                border: "none",
                borderRadius: 6,
                background: "transparent",
                color: COLORS.slateMid,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Low stock
            </button>
            <button
              type="button"
              style={{
                height: 30,
                padding: "0 14px",
                border: "none",
                borderRadius: 6,
                background: "transparent",
                color: COLORS.slateMid,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Out of stock
            </button>
          </div>
        </div>

        <ProductTable products={products} />

        <Suspense fallback={null}>
          <Pagination page={page} perPage={perPage} total={total} totalPages={totalPages} />
        </Suspense>
      </div>
    </div>
  );
}
