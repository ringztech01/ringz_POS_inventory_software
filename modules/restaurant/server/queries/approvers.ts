import "server-only";
import { prisma } from "@/lib/db";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import { hasPermissionWhere } from "../services/orders";

// Who can approve a discount above the limit: users with Approve Discount
// who have set an approval PIN — the Bill panel's approver list.
export type Approver = { id: string; name: string };

export async function getDiscountApprovers(): Promise<Approver[]> {
  const users = await prisma.user.findMany({
    where: { ...hasPermissionWhere(RESTAURANT_PERMISSIONS.APPROVE_DISCOUNT), approvalPin: { isNot: null } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });
  return users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }));
}

// My approval PIN: whether this user has one, and since when.
export async function getApprovalPinStatus(userId: string): Promise<{ hasPin: boolean; updatedAt: string | null }> {
  const pin = await prisma.approvalPin.findUnique({ where: { userId }, select: { updatedAt: true } });
  return { hasPin: !!pin, updatedAt: pin?.updatedAt.toISOString() ?? null };
}
