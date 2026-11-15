import { exportReport } from "@/modules/restaurant/server/reportExportRoute";

// /restaurant/reports/export/<tab> — Restaurant Reports' Excel export.
export async function GET(request: Request, { params }: { params: Promise<{ tab: string }> }) {
  return exportReport(request, (await params).tab);
}
