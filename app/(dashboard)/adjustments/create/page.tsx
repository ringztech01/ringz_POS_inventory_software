import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AdjustmentForm from "@/components/adjustments/AdjustmentForm";
import { getActiveWarehouses } from "../queries";

export default async function CreateAdjustmentPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const warehouses = await getActiveWarehouses();

  return <AdjustmentForm warehouses={warehouses} />;
}
