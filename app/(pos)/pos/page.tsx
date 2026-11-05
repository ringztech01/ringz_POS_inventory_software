import type { Metadata } from "next";
import { auth } from "@/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/permissions.server";
import { getActiveWarehouses } from "@/app/(dashboard)/purchases/queries";
import { getActiveCustomers } from "@/app/(dashboard)/sales/queries";
import PosScreen from "@/components/pos/PosScreen";
import { RECEIPT } from "@/lib/hardware/assignments";
import { currentDeviceId } from "@/lib/hardware/device";
import { drawerPrinterFor } from "@/lib/hardware/drawer";
import { printerFor } from "@/lib/hardware/printQueue";
import { getPosCatalog, getPosFilters } from "./queries";

export const metadata: Metadata = { title: "POS — RingzPOS" };

// /pos — loads the first screen (warehouses, customers, chips and the first
// warehouse's grid); everything after that is client state, with a server
// call only to reload a warehouse's grid and, at payment, createPosSale.
export default async function PosPage() {
  const denied = await pageGuard(PERMISSIONS.MANAGE_POS_SCREEN);
  if (denied) return <div style={{ padding: 32 }}>{denied}</div>;

  const deviceId = await currentDeviceId();
  const [session, canViewSales, warehouses, customers, filters, receiptPrinter, drawerPrinter] = await Promise.all([
    auth(),
    can(PERMISSIONS.MANAGE_SALE),
    getActiveWarehouses(),
    getActiveCustomers(),
    getPosFilters(),
    // This till's receipt printer (Settings › Printers); none: the receipt page.
    printerFor(RECEIPT, deviceId),
    // Open drawer: Open Drawer holders at a till with a drawer.
    can(PERMISSIONS.OPEN_DRAWER).then((allowed) => (allowed ? drawerPrinterFor(deviceId) : null)),
  ]);
  const firstWarehouse = warehouses[0];
  const products = firstWarehouse ? await getPosCatalog(firstWarehouse.id) : [];

  return (
    <PosScreen
      userId={session?.user?.id ?? ""}
      canViewSales={canViewSales}
      receiptPrinter={receiptPrinter}
      drawerPrinter={drawerPrinter?.name ?? null}
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
