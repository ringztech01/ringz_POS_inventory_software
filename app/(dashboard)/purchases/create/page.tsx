import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import PurchaseForm from "@/components/purchases/PurchaseForm";
import { getActiveSuppliers, getActiveWarehouses } from "../queries";

export default async function CreatePurchasePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_PURCHASES)) {
    redirect("/purchases");
  }

  const [warehouses, suppliers] = await Promise.all([getActiveWarehouses(), getActiveSuppliers()]);

  return <PurchaseForm warehouses={warehouses} suppliers={suppliers} />;
}
