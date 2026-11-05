import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { getPrintJobs, getQueuePrinters, JOBS_PER_PAGE, readJobFilter } from "@/lib/hardware/printJobs";
import ForbiddenState from "@/components/ui/ForbiddenState";
import PrintQueuePanel from "@/components/settings/printers/PrintQueuePanel";

// /settings/print-queue[?printer&status&page] — every print job, newest
// first: what, where (and where it was rerouted from), how it went; Retry,
// Reprint, Cancel. Needs Manage Setting.
export default async function PrintQueuePage({ searchParams }: { searchParams: Promise<{ printer?: string; status?: string; page?: string }> }) {
  const { permissions } = await getCurrentUserPermissions();
  if (!permissions.has(PERMISSIONS.MANAGE_SETTING)) return <ForbiddenState permission={PERMISSIONS.MANAGE_SETTING} />;
  const printers = await getQueuePrinters();
  const filter = readJobFilter(await searchParams, printers.map((p) => p.id));
  const { rows, total, counts } = await getPrintJobs(filter);
  return (
    <PrintQueuePanel
      rows={rows}
      counts={counts}
      printers={printers}
      printerId={filter.printerId ?? ""}
      status={filter.status ?? ""}
      page={filter.page}
      total={total}
      totalPages={Math.max(1, Math.ceil(total / JOBS_PER_PAGE))}
    />
  );
}
