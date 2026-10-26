import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import SupplierForm from "@/components/suppliers/SupplierForm";
import { getSupplierById } from "../../queries";
import { updateSupplier } from "../../actions";

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_SUPPLIERS);
  if (denied) return denied;

  const { id } = await params;
  const supplier = await getSupplierById(id);

  if (!supplier) {
    notFound();
  }

  return <SupplierForm supplier={supplier} action={updateSupplier.bind(null, supplier.id)} />;
}
