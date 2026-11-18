import "server-only";
import { prisma } from "@/lib/db";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { buildWorkbook, workbookStream, xlsxResponse, xlsxStreamResponse } from "@/lib/reports/exportXlsx";
import { reportTabFor, type ReportTabKey } from "../lib/reportTabs";
import { appZoneOffsetMinutes } from "../lib/time";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardRoute } from "./guard";
import { keepKnown, parseReportFilters } from "./queries/reports/filters";
import { getReportSetup } from "./queries/reports/shell";
import { buildReportExport } from "./reportExport";
import { businessName } from "./businessName";

// GET /restaurant/reports/export/<tab>?<the page's query> — the tab as an
// Excel workbook (server/reportExport.ts): the same filters, sorting and
// grouping as on screen. 404 while the module is off; Restaurant Reports
// needed (the Service-only roles never have it). Over STREAM_ROWS rows, the
// workbook streams.

export async function exportReport(request: Request, segment: string): Promise<Response> {
  const denied = await guardRoute(RESTAURANT_PERMISSIONS.RESTAURANT_REPORTS);
  if (denied) return denied;
  const tab: ReportTabKey | null = segment === "overview" ? "overview" : (reportTabFor(segment)?.key ?? null);
  if (!tab) return new Response("Not found", { status: 404 });

  const [current, setup] = await Promise.all([getCurrentUserPermissions(), getReportSetup()]);
  if (!setup.ok) return new Response(setup.error, { status: 500 });
  const params = new URL(request.url).searchParams;
  const parsed = parseReportFilters(Object.fromEntries(params), { dayStartMinutes: setup.data.dayStartMinutes });
  const { areas, waiters, stations, devices } = setup.data;
  const filters = keepKnown(parsed.filters, { areas: areas.map((a) => a.id), waiters: waiters.map((w) => w.id), stations: stations.map((s) => s.id), devices: devices.map((d) => d.id) });
  const me = current.userId ? await prisma.user.findUnique({ where: { id: current.userId }, select: { displayName: true, firstName: true, lastName: true } }) : null;
  const now = new Date();

  const book = await buildReportExport({
    tab,
    window: parsed.window,
    filters,
    params,
    setup: setup.data,
    withCost: current.permissions.has(RESTAURANT_PERMISSIONS.VIEW_COST),
    canAudit: current.permissions.has(RESTAURANT_PERMISSIONS.VIEW_AUDIT_LOG),
    clockInOut: false,
    business: await businessName(),
    generatedBy: me ? me.displayName || `${me.firstName} ${me.lastName}`.trim() : "—",
    now,
  });
  if (!book.ok) return new Response(book.error, { status: 500 });
  const options = { utcOffsetMinutes: appZoneOffsetMinutes(now), now };
  return book.data.stream ? xlsxStreamResponse(book.data.filename, workbookStream(book.data.sheets, options)) : xlsxResponse(book.data.filename, await buildWorkbook(book.data.sheets, options));
}
