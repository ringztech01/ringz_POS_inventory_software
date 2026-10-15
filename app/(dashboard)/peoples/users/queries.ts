import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type UserListParams = {
  q?: string;
  page?: number;
  perPage?: number;
};

const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phoneNumber: true,
  image: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER_SELECT }>;

export async function getUserList({ q, page = 1, perPage = 10 }: UserListParams) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { firstName: { contains: q } },
            { lastName: { contains: q } },
            { email: { contains: q } },
          ],
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: PUBLIC_USER_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return { users, total };
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  return prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: PUBLIC_USER_SELECT,
  });
}
