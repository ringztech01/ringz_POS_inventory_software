import type { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/permissions";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { isExportReport, type ReportSearchParams } from "@/lib/reports/params";
import { buildReportExport } from "@/lib/reports/exports";
import { xlsxResponse } from "@/lib/reports/exportXlsx";

// GET /reports/export/[report]?warehouse&tab&from&to&q — the report's current
// filtered set (no pagination) as .xlsx. Route handlers skip the reports
// layout's guard, so Manage Reports is checked here.
export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const current = await getCurrentUserPermissions();
  if (!current.userId) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!current.permissions.has(PERMISSIONS.MANAGE_REPORTS)) {
    return new Response("Forbidden", { status: 403 });
  }

  const { report } = await params;
  if (!isExportReport(report)) {
    return new Response("Report not found", { status: 404 });
  }

  const search = request.nextUrl.searchParams;
  const filters: ReportSearchParams = {
    warehouse: search.get("warehouse") ?? undefined,
    tab: search.get("tab") ?? undefined,
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
    q: search.get("q") ?? undefined,
  };

  const result = await buildReportExport(report, filters);
  if ("error" in result) {
    return new Response(result.error, { status: 413 });
  }
  return xlsxResponse(result.filename, result.file);
}
