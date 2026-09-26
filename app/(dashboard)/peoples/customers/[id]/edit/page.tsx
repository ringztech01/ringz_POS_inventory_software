import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import CustomerForm from "@/components/customers/CustomerForm";
import { getCustomerById } from "../../queries";
import { updateCustomer } from "../../actions";

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_CUSTOMERS)) {
    redirect("/peoples/customers");
  }

  const { id } = await params;
  const customer = await getCustomerById(id);

  if (!customer) {
    notFound();
  }

  return <CustomerForm customer={customer} action={updateCustomer.bind(null, customer.id)} />;
}
