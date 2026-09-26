import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import WarehouseForm from "@/components/warehouse/WarehouseForm";
import { createWarehouse } from "../actions";

export default async function CreateWarehousePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_WAREHOUSES)) {
    redirect("/warehouse");
  }

  return <WarehouseForm action={createWarehouse} />;
}
