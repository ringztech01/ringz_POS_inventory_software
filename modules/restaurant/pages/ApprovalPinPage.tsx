import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { FONTS } from "@/components/layout/theme";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPageAny } from "../server/guard";
import { getApprovalPinStatus } from "../server/queries/approvers";
import ApprovalPinForm from "../components/settings/ApprovalPinForm";

// /restaurant/settings/approval-pin — My approval PIN: the signed-in user's
// own PIN for approving a discount or waste above its limit. Needs Approve
// Discount or Approve Waste.
export default async function ApprovalPinPage() {
  const denied = await guardPageAny([RESTAURANT_PERMISSIONS.APPROVE_DISCOUNT, RESTAURANT_PERMISSIONS.APPROVE_WASTE]);
  if (denied) return denied;

  const { userId } = await getCurrentUserPermissions();
  const status = await getApprovalPinStatus(userId ?? "");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 520 }}>
      <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 24, fontWeight: 600, letterSpacing: "-.01em" }}>My approval PIN</h1>
      <ApprovalPinForm hasPin={status.hasPin} updatedAt={status.updatedAt} />
    </div>
  );
}
