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

  // The walk-in customer the POS uses when no specific customer is
  // selected. Protected server-side (see app/(dashboard)/customers/actions.ts)
  // so it can't be deleted or renamed. No unique field to upsert against, so
  // find-or-create instead.
  const existingDirectCustomer = await prisma.customer.findFirst({ where: { isDefault: true } });
  const directCustomer =
    existingDirectCustomer ??
    (await prisma.customer.create({
      data: {
        name: "direct-customer",
        email: "customer@ringzpos.com",
        phoneNumber: "123456789",
        country: "",
        city: "",
        address: "",
        isDefault: true,
      },
    }));

  console.log(`Seeded direct-customer: ${directCustomer.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
