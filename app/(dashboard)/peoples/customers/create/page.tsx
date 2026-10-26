import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pageGuard } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/permissions";
import CustomerForm from "@/components/customers/CustomerForm";
import { createCustomer } from "../actions";

export default async function CreateCustomerPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/");
  }

  const denied = await pageGuard(PERMISSIONS.MANAGE_CUSTOMERS);
  if (denied) return denied;

  return <CustomerForm action={createCustomer} />;
}
