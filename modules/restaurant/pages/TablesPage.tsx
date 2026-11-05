import { Suspense } from "react";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { getBusinessSettings } from "@/lib/business-settings";
import { todayInAppZone } from "@/lib/dateRanges";
import { getActiveWarehouses } from "@/app/(dashboard)/purchases/queries";
import { isCalendarDay, formatMinutes } from "../lib/time";
import { RESTAURANT_PERMISSIONS as P } from "../manifest";
import { guardPageAny } from "../server/guard";
import { getDiningAreas } from "../server/queries/diningAreas";
import { getBookingOptions, getReservationsForDay } from "../server/queries/reservations";
import { getTableList } from "../server/queries/tables";
import DiningAreasPanel from "../components/tables/DiningAreasPanel";
import TablesPanel from "../components/tables/TablesPanel";
import ReservationsPanel from "../components/reservations/ReservationsPanel";

const PER_PAGE_OPTIONS = [10, 25];

type TablesSearchParams = { q?: string; area?: string; page?: string; perPage?: string; date?: string };

async function loadTables(params: TablesSearchParams) {
  const q = params.q?.trim() || "";
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  const perPage = PER_PAGE_OPTIONS.includes(Number(params.perPage)) ? Number(params.perPage) : PER_PAGE_OPTIONS[0];
  const [areas, warehouses] = await Promise.all([getDiningAreas(), getActiveWarehouses()]);
  // An unknown or deleted area in the URL means "All areas".
  const areaId = areas.some((area) => area.id === params.area) ? params.area : undefined;
  const { rows, total } = await getTableList({ q, areaId, page, perPage });
  return { q, page, perPage, areas, warehouses, areaId, rows, total };
}

async function loadBookings(day: string) {
  const [rows, options, settings] = await Promise.all([getReservationsForDay(day), getBookingOptions(), getBusinessSettings()]);
  return { rows, options, gapLabel: formatMinutes(settings.restaurantBookingGapMinutes) };
}

// /restaurant/tables — RingzPOS Tables design: the tables list (left), dining
// areas and reservations (right). Opens with Manage Tables (tables, areas)
// or Manage Reservations (reservations); each part shows with its own.
export default async function TablesPage({ searchParams }: { searchParams: Promise<TablesSearchParams> }) {
  const denied = await guardPageAny([P.MANAGE_TABLES, P.MANAGE_RESERVATIONS]);
  if (denied) return denied;

  const { permissions } = await getCurrentUserPermissions();
  const params = await searchParams;
  const today = todayInAppZone();
  const day = isCalendarDay(params.date) ? params.date : today;
  const [tables, bookings] = await Promise.all([
    permissions.has(P.MANAGE_TABLES) ? loadTables(params) : null,
    permissions.has(P.MANAGE_RESERVATIONS) ? loadBookings(day) : null,
  ]);

  const reservations = bookings && (
    <Suspense fallback={null}>
      <ReservationsPanel
        rows={bookings.rows}
        day={day}
        today={today}
        gapLabel={bookings.gapLabel}
        tables={bookings.options.tables}
        customers={bookings.options.customers}
      />
    </Suspense>
  );

  if (!tables) return <div style={{ maxWidth: 640 }}>{reservations}</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
      <TablesPanel
        rows={tables.rows}
        areas={tables.areas.map((area) => ({ id: area.id, name: area.name, warehouseName: area.warehouseName }))}
        areaId={tables.areaId ?? ""}
        filtered={!!tables.q || !!tables.areaId}
        page={tables.page}
        perPage={tables.perPage}
        total={tables.total}
        totalPages={Math.max(1, Math.ceil(tables.total / tables.perPage))}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <DiningAreasPanel areas={tables.areas} warehouses={tables.warehouses.map((w) => ({ value: w.id, label: w.name }))} />
        {reservations}
      </div>
    </div>
  );
}
