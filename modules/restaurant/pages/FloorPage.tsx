import Link from "next/link";
import { getCurrentUserPermissions } from "@/lib/auth/permissions.server";
import { PERMISSIONS } from "@/lib/permissions";
import { currentDeviceId } from "@/lib/hardware/device";
import { drawerPrinterFor } from "@/lib/hardware/drawer";
import OpenDrawerButton from "@/components/hardware/OpenDrawerButton";
import { COLORS } from "@/components/layout/theme";
import { TABLE_STATUSES } from "../lib/tableStatus";
import { FLOOR_LEGEND } from "../lib/theme";
import { RESTAURANT_PERMISSIONS as P } from "../manifest";
import { guardPageAny } from "../server/guard";
import { getFloor } from "../server/queries/floor";
import FloorBoard from "../components/floor/FloorBoard";
import FloorPolling from "../components/floor/FloorPolling";
import NewTakeawayButton from "../components/floor/NewTakeawayButton";
import HeaderActions from "../components/HeaderActions";

// Who can look at the floor. Opening orders, takeaways and Mark clean need
// Manage Orders; seating a booking needs Manage Reservations.
const VIEWERS = [P.MANAGE_ORDERS, P.MANAGE_TABLES, P.MANAGE_RESERVATIONS, P.RESTAURANT_DASHBOARD];

// /restaurant/floor[?area=] — RingzPOS Floor Plan design: area tabs, the
// status legend (all areas), the area's table cards and the side panel.
// Statuses and money come from the server; the board polls every 5s.
export default async function FloorPage({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const denied = await guardPageAny(VIEWERS);
  if (denied) return denied;

  const { permissions } = await getCurrentUserPermissions();
  const canOrders = permissions.has(P.MANAGE_ORDERS);
  const canBook = permissions.has(P.MANAGE_RESERVATIONS);
  const { area } = await searchParams;
  const floor = await getFloor(area);
  // Open drawer: Open Drawer holders at a till with a cash drawer.
  const drawer = permissions.has(PERMISSIONS.OPEN_DRAWER) ? await drawerPrinterFor(await currentDeviceId()) : null;

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 16, rowGap: 10, flexWrap: "wrap" }}>
      {floor.areas.length > 0 && (
        <nav aria-label="Areas" style={{ display: "flex", gap: 4, background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: 3 }}>
          {floor.areas.map((a) => {
            const on = a.id === floor.areaId;
            return (
              <Link
                key={a.id}
                href={`/restaurant/floor?area=${a.id}`}
                replace
                scroll={false}
                aria-current={on ? "page" : undefined}
                style={{
                  height: 32,
                  padding: "0 14px",
                  borderRadius: 6,
                  background: on ? COLORS.teal : "transparent",
                  color: on ? "#fff" : COLORS.slate,
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {a.name}
              </Link>
            );
          })}
        </nav>
      )}
      <div aria-label="Legend" style={{ marginLeft: "auto", display: "flex", gap: 16, flexWrap: "wrap" }}>
        {TABLE_STATUSES.map((status) => (
          <span key={status} data-legend={status} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: COLORS.slate, whiteSpace: "nowrap" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: FLOOR_LEGEND[status] }} />
            {status} · {floor.legend[status]}
          </span>
        ))}
      </div>
    </div>
  );

  const emptyMessage =
    floor.areas.length === 0 ? "No dining areas yet. Add areas and tables on the Tables page." : "No tables in this area yet.";

  return (
    // Flush under the restaurant header and to the edges, as in the design
    // (cancels the dashboard <main>'s padding and gap).
    <div style={{ margin: "-24px -32px 0", display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", minHeight: "calc(100vh - 120px)" }}>
      <HeaderActions>
        {drawer && <OpenDrawerButton printer={drawer.name} />}
        <NewTakeawayButton
          areaId={floor.areaId}
          disabledReason={!canOrders ? "Needs the Manage Orders permission." : !floor.areaId ? "Add a dining area first." : null}
        />
      </HeaderActions>
      <FloorBoard header={header} tables={floor.tables} targets={floor.targets} emptyMessage={emptyMessage} canOrders={canOrders} canBook={canBook} />
      <FloorPolling />
    </div>
  );
}
