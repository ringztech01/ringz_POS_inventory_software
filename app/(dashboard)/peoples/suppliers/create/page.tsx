import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import SupplierForm from "@/components/suppliers/SupplierForm";
import { createSupplier } from "../actions";

export default async function CreateSupplierPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_SUPPLIERS);
  if (denied) return denied;

  return <SupplierForm action={createSupplier} />;
}
