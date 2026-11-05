import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { todayInAppZone } from "@/lib/dateRanges";
import { dayLabel } from "../lib/time";
import { readWasteFilter } from "../lib/waste";
import { RESTAURANT_PERMISSIONS } from "../manifest";
import { guardPageAny } from "../server/guard";
import { getWasteApprovers } from "../server/queries/approvers";
import { getWasteItemOptions, getWasteList, getWasteSummary, getWasteUsers } from "../server/queries/waste";
import FoodTabs from "../components/food/FoodTabs";
import WastePanel from "../components/food/WastePanel";

const PER_PAGE_OPTIONS = [10, 25];

type Params = { from?: string; to?: string; reason?: string; user?: string; status?: string; q?: string; page?: string; perPage?: string };

// /restaurant/food/waste — Food › Waste: the waste logged in the period
// (default today) with its summary, filters in the URL. Opens with Log
// Waste or Approve Waste; logging needs Log Waste, voiding Approve Waste.
export default async function FoodWastePage({ searchParams }: { searchParams: Promise<Params> }) {
  const P = RESTAURANT_PERMISSIONS;
  const denied = await guardPageAny([P.LOG_WASTE, P.APPROVE_WASTE]);
  if (denied) return denied;

  const { permissions } = await getCurrentUserPermissions();
  const canLog = permissions.has(P.LOG_WASTE);
  const canVoid = permissions.has(P.APPROVE_WASTE);

  const params = await searchParams;
  const users = await getWasteUsers();
  const filter = readWasteFilter(params, users.map((u) => u.id));
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : 25;
  const [{ rows, total }, summary, items, approvers] = await Promise.all([
    getWasteList(filter, page, perPage),
    getWasteSummary(filter.range),
    canLog ? getWasteItemOptions() : Promise.resolve([]),
    canLog ? getWasteApprovers() : Promise.resolve([]),
  ]);

  const today = todayInAppZone();
  const { from, to } = filter.range;
  const period = from === to ? dayLabel(from, today) : `${dayLabel(from, today)} – ${dayLabel(to, today)}`;

  return (
    <WastePanel
      tabs={<FoodTabs active="waste" />}
      rows={rows}
      summary={summary}
      period={period}
      today={today}
      reason={filter.reason ?? ""}
      userId={filter.userId ?? ""}
      status={filter.status ?? ""}
      users={users}
      filtered={!!(filter.reason || filter.userId || filter.status || filter.q)}
      items={items}
      approvers={approvers}
      canLog={canLog}
      canVoid={canVoid}
      page={page}
      perPage={perPage}
      total={total}
      totalPages={Math.max(1, Math.ceil(total / perPage))}
    />
  );
}
