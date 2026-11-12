import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPageAny } from "../server/guard";
import { getApprovalPinStatus } from "../server/queries/approvers";
import ApprovalPinForm from "../components/settings/ApprovalPinForm";
import { getStaffSettings } from "../server/services/staff";

// /restaurant/settings/approval-pin — My PIN: the signed-in user's own PIN.
// It signs them in on the touch POS and, for someone who approves, approves
// a discount or waste above its limit. Needs Manage Orders, Approve Discount
// or Approve Waste.
export default async function ApprovalPinPage() {
  const denied = await guardPageAny([RESTAURANT_PERMISSIONS.MANAGE_ORDERS, RESTAURANT_PERMISSIONS.APPROVE_DISCOUNT, RESTAURANT_PERMISSIONS.APPROVE_WASTE]);
  if (denied) return denied;

  const { userId } = await getCurrentUserPermissions();
  const [status, settings] = await Promise.all([getApprovalPinStatus(userId ?? ""), getStaffSettings()]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 520 }}>
      <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>My PIN</h1>
      <ApprovalPinForm hasPin={status.hasPin} updatedAt={status.updatedAt} oldPin={status.oldPin} selfPin={settings.staffSelfPin} />
    </div>
  );
}
