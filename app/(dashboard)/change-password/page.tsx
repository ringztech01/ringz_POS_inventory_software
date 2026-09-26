import { redirect } from "next/navigation";
import { auth } from "@/auth";
import ChangePasswordForm from "@/components/change-password/ChangePasswordForm";

export default async function ChangePasswordPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  return <ChangePasswordForm />;
}
