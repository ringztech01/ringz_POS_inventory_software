import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ProfileForm from "@/components/profile/ProfileForm";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phoneNumber: true,
      image: true,
      role: true,
    },
  });

  if (!user) {
    redirect("/");
  }

  return <ProfileForm user={user} />;
}
