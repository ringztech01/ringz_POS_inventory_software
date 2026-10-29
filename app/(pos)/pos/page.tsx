import type { Metadata } from "next";
import { auth } from "@/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/permissions.server";
import { getActiveWarehouses } from "@/app/(dashboard)/purchases/queries";
import { getActiveCustomers } from "@/app/(dashboard)/sales/queries";
import PosScreen from "@/components/pos/PosScreen";
import { getPosCatalog, getPosFilters } from "./queries";

export const metadata: Metadata = { title: "POS — RingzPOS" };

// /pos — loads the first screen (warehouses, customers, chips and the first
// warehouse's grid); everything after that is client state, with a server
// call only to reload a warehouse's grid and, at payment, createPosSale.
export default async function PosPage() {
  const denied = await pageGuard(PERMISSIONS.MANAGE_POS_SCREEN);
  if (denied) return <div style={{ padding: 32 }}>{denied}</div>;

  const [session, canViewSales, warehouses, customers, filters] = await Promise.all([
    auth(),
    can(PERMISSIONS.MANAGE_SALE),
    getActiveWarehouses(),
    getActiveCustomers(),
    getPosFilters(),
  ]);
  const firstWarehouse = warehouses[0];
  const products = firstWarehouse ? await getPosCatalog(firstWarehouse.id) : [];

  return (
    <PosScreen
      userId={session?.user?.id ?? ""}
      canViewSales={canViewSales}
      warehouses={warehouses}
      customers={customers.map(({ id, name }) => ({ id, name }))}
      // The protected walk-in ("direct-customer") is the default.
      defaultCustomerId={customers.find((customer) => customer.isDefault)?.id ?? customers[0]?.id ?? ""}
      categories={filters.categories}
      brands={filters.brands}
      initialWarehouseId={firstWarehouse?.id ?? ""}
      initialProducts={products}
    />
  );
}
