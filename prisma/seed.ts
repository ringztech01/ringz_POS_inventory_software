import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "../lib/db";

const ADMIN_EMAIL = "ringztech01@gmail.com";
const ADMIN_PASSWORD = "ChangeMe123!";

async function main() {
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      firstName: "System",
      lastName: "Administrator",
      email: ADMIN_EMAIL,
      password: hashedPassword,
      phoneNumber: "+2348012345678",
      image: "https://ui-avatars.com/api/?name=System+Administrator",
      role: Role.ADMIN,
    },
  });

  console.log(`Seeded admin user: ${admin.email} (id: ${admin.id})`);
  console.log(`Initial password: ${ADMIN_PASSWORD} — change this after first login.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
