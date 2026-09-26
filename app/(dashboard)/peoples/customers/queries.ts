import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type CustomerListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

export async function getCustomerList({ q, page = 1, perPage = 10 }: CustomerListParams) {
  const where: Prisma.CustomerWhereInput = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { city: { contains: q } },
          ],
        }
      : {}),
  };

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { customers, total };
}

export async function getCustomerById(id: string) {
  return prisma.customer.findFirst({
    where: { id, deletedAt: null },
  });
}

// No modules reference Customer yet — Sales and Quotations don't exist in
// the schema yet. When they do, each gets a `customerId` foreign key — add a
// `prisma.<model>.count({ where: { customerId: id } })` check here per
// relation and return true if any of them is non-zero. Until then, nothing
// can actually be "in use", so this always reports false.
export async function isCustomerInUse(id: string): Promise<boolean> {
  void id;
  return false;
}
