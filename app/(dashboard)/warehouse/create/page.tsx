import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import WarehouseForm from "@/components/warehouse/WarehouseForm";
import { createWarehouse } from "../actions";

export default async function CreateWarehousePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_WAREHOUSES);
  if (denied) return denied;

  return <WarehouseForm action={createWarehouse} />;
}
