import "server-only";
import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { RESTAURANT_PERMISSIONS } from "../../manifest";
import type { ApprovalPermission } from "../services/approvalPins";
import { hasPermissionWhere } from "../services/orders";

// Who can approve a discount (or waste) above its limit: users with Approve
// Discount (Approve Waste) who have set an approval PIN — the approver lists.
export type Approver = { id: string; name: string };

export const getDiscountApprovers = () => getApprovers(RESTAURANT_PERMISSIONS.APPROVE_DISCOUNT);
export const getWasteApprovers = () => getApprovers(RESTAURANT_PERMISSIONS.APPROVE_WASTE);
// The touch POS's manager PIN: voids and refunds, and the drawer.
export const getVoidApprovers = () => getApprovers(RESTAURANT_PERMISSIONS.APPROVE_VOID);
export const getDrawerApprovers = () => getApprovers(PERMISSIONS.OPEN_DRAWER);

async function getApprovers(permission: ApprovalPermission): Promise<Approver[]> {
  const users = await prisma.user.findMany({
    where: { ...hasPermissionWhere(permission), approvalPin: { isNot: null } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });
  return users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }));
}

// My approval PIN: whether this user has one, and since when.
// meetsRules (Part 6f): set under the current PIN rules — else an old PIN.
export async function getApprovalPinStatus(userId: string): Promise<{ hasPin: boolean; updatedAt: string | null; oldPin: boolean }> {
  const pin = await prisma.approvalPin.findUnique({ where: { userId }, select: { updatedAt: true, meetsRules: true } });
  return { hasPin: !!pin, updatedAt: pin?.updatedAt.toISOString() ?? null, oldPin: !!pin && !pin.meetsRules };
}
