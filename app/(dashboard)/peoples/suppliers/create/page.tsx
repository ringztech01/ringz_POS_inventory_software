import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import SupplierForm from "@/components/suppliers/SupplierForm";
import { createSupplier } from "../actions";

export default async function CreateSupplierPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_SUPPLIERS)) {
    redirect("/peoples/suppliers");
  }

  return <SupplierForm action={createSupplier} />;
}
