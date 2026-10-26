import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import ProfileForm from "@/components/profile/ProfileForm";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const user = await prisma.user.findFirst({
    where: { id: session.user.id, deletedAt: null },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phoneNumber: true,
      image: true,
      userRole: { select: { name: true, deletedAt: true } },
    },
  });

  if (!user) {
    redirect("/");
  }

  const { userRole, ...rest } = user;
  return <ProfileForm user={{ ...rest, roleName: userRole && !userRole.deletedAt ? userRole.name : "No role" }} />;
}
