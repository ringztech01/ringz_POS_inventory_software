import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import SupplierForm from "@/components/suppliers/SupplierForm";
import { getSupplierById } from "../../queries";
import { updateSupplier } from "../../actions";

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_SUPPLIERS)) {
    redirect("/peoples/suppliers");
  }

  const { id } = await params;
  const supplier = await getSupplierById(id);

  if (!supplier) {
    notFound();
  }

  return <SupplierForm supplier={supplier} action={updateSupplier.bind(null, supplier.id)} />;
}
