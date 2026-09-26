import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import CustomerForm from "@/components/customers/CustomerForm";
import { createCustomer } from "../actions";

export default async function CreateCustomerPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  if (!hasPermission(session.user.role, PERMISSIONS.MANAGE_CUSTOMERS)) {
    redirect("/peoples/customers");
  }

  return <CustomerForm action={createCustomer} />;
}
