import Link from "next/link";
import { notFound } from "next/navigation";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import { getStockReportProduct } from "@/lib/reports/queries";
import { COLORS } from "@/components/layout/theme";
import ReportStub from "@/components/reports/ReportStub";

// /reports/stock/[productId] — one product's stock report (stub for now).
export default async function ProductStockReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ warehouse?: string }>;
}) {
  const denied = await pageGuard(PERMISSIONS.MANAGE_REPORTS);
  if (denied) return denied;

  const [{ productId }, { warehouse }] = await Promise.all([params, searchParams]);
  const product = await getStockReportProduct(productId);
  if (!product) notFound();

  return (
    <>
      <Link
        href={warehouse ? `/reports/stock?warehouse=${encodeURIComponent(warehouse)}` : "/reports/stock"}
        style={{ fontSize: 13.5, fontWeight: 600, color: COLORS.teal, textDecoration: "none", alignSelf: "flex-start" }}
      >
        ← Stock Reports
      </Link>
      <ReportStub title={`${product.name} (${product.code}) stock report`} />
    </>
  );
}
