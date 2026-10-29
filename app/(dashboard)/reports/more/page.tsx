import { PERMISSIONS } from "@/lib/permissions";
import { pageGuard } from "@/lib/auth/page-guard";
import ReportStub from "@/components/reports/ReportStub";

// /reports/more — stub (More reports isn't part of this build).
export default async function MoreReportsPage() {
  const denied = await pageGuard(PERMISSIONS.MANAGE_REPORTS);
  if (denied) return denied;

  return <ReportStub title="More reports" />;
}
