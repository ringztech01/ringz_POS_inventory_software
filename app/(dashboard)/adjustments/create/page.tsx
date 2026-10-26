import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import AdjustmentForm from "@/components/adjustments/AdjustmentForm";
import { getActiveWarehouses } from "../queries";

export default async function CreateAdjustmentPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_ADJUSTMENTS);
  if (denied) return denied;

  const warehouses = await getActiveWarehouses();

  return <AdjustmentForm warehouses={warehouses} />;
}
