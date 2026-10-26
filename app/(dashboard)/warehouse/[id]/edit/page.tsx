import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import WarehouseForm from "@/components/warehouse/WarehouseForm";
import { getWarehouseById } from "../../queries";
import { updateWarehouse } from "../../actions";

export default async function EditWarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_WAREHOUSES);
  if (denied) return denied;

  const { id } = await params;
  const warehouse = await getWarehouseById(id);

  if (!warehouse) {
    notFound();
  }

  return <WarehouseForm warehouse={warehouse} action={updateWarehouse.bind(null, warehouse.id)} />;
}
